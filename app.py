import os
import random
from datetime import datetime

import chess
from flask import Flask, jsonify, redirect, render_template, request, url_for
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_socketio import SocketIO, emit, join_room
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-me")
db_url = os.getenv("DATABASE_URL", "sqlite:///chess.db")
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "login"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent")


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(32), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    rating = db.Column(db.Integer, default=1200, nullable=False)
    wins = db.Column(db.Integer, default=0, nullable=False)
    losses = db.Column(db.Integer, default=0, nullable=False)
    draws = db.Column(db.Integer, default=0, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Game(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    white_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    black_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    mode = db.Column(db.String(16), nullable=False, default="bot")
    bot_level = db.Column(db.String(16), nullable=True)
    fen = db.Column(db.Text, nullable=False, default=chess.STARTING_FEN)
    moves = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(16), nullable=False, default="active")
    result = db.Column(db.String(8), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Challenge(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    receiver_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    status = db.Column(db.String(16), default="pending", nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def user_can_access(game):
    return current_user.is_authenticated and current_user.id in (game.white_id, game.black_id)


def piece_value(piece):
    return {chess.PAWN: 100, chess.KNIGHT: 320, chess.BISHOP: 330,
            chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 20000}[piece.piece_type]


def evaluate(board):
    if board.is_checkmate():
        return -999999 if board.turn else 999999
    score = 0
    for square, piece in board.piece_map().items():
        value = piece_value(piece)
        center_bonus = 12 if square in [chess.D4, chess.E4, chess.D5, chess.E5] else 0
        score += (value + center_bonus) if piece.color == chess.WHITE else -(value + center_bonus)
    return score


def minimax(board, depth, alpha, beta, maximizing):
    if depth == 0 or board.is_game_over():
        return evaluate(board)
    moves = list(board.legal_moves)
    random.shuffle(moves)
    if maximizing:
        best = -10**9
        for move in moves:
            board.push(move)
            best = max(best, minimax(board, depth - 1, alpha, beta, False))
            board.pop()
            alpha = max(alpha, best)
            if beta <= alpha:
                break
        return best
    best = 10**9
    for move in moves:
        board.push(move)
        best = min(best, minimax(board, depth - 1, alpha, beta, True))
        board.pop()
        beta = min(beta, best)
        if beta <= alpha:
            break
    return best


def choose_bot_move(board, level):
    legal = list(board.legal_moves)
    if not legal:
        return None
    if level == "beginner":
        return random.choice(legal)
    if level == "easy" and random.random() < 0.35:
        return random.choice(legal)
    depth = {"easy": 1, "medium": 2, "hard": 3, "expert": 3}.get(level, 2)
    best_score = 10**9
    best_moves = []
    for move in legal:
        board.push(move)
        score = minimax(board, depth - 1, -10**9, 10**9, True)
        board.pop()
        if score < best_score:
            best_score, best_moves = score, [move]
        elif score == best_score:
            best_moves.append(move)
    return random.choice(best_moves)


def finish_game(game, board):
    if not board.is_game_over():
        return
    game.status = "finished"
    game.result = board.result()
    if game.mode == "online" and game.white_id and game.black_id:
        white = db.session.get(User, game.white_id)
        black = db.session.get(User, game.black_id)
        if game.result == "1-0":
            white.wins += 1; black.losses += 1
            white.rating += 16; black.rating = max(100, black.rating - 16)
        elif game.result == "0-1":
            black.wins += 1; white.losses += 1
            black.rating += 16; white.rating = max(100, white.rating - 16)
        else:
            white.draws += 1; black.draws += 1
    db.session.commit()


@app.route("/")
def index():
    leaders = User.query.order_by(User.rating.desc()).limit(10).all()
    return render_template("index.html", leaders=leaders)


@app.route("/register", methods=["GET", "POST"])
def register():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if len(username) < 3 or len(password) < 6:
            error = "Логин — от 3 символов, пароль — от 6."
        elif User.query.filter_by(username=username).first():
            error = "Такой игрок уже зарегистрирован."
        else:
            user = User(username=username, password_hash=generate_password_hash(password))
            db.session.add(user); db.session.commit(); login_user(user)
            return redirect(url_for("dashboard"))
    return render_template("auth.html", title="Регистрация", error=error)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        user = User.query.filter_by(username=request.form.get("username", "").strip()).first()
        if user and check_password_hash(user.password_hash, request.form.get("password", "")):
            login_user(user); return redirect(url_for("dashboard"))
        error = "Неверный логин или пароль."
    return render_template("auth.html", title="Вход", error=error)


@app.route("/logout")
def logout():
    logout_user(); return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    games = Game.query.filter((Game.white_id == current_user.id) | (Game.black_id == current_user.id)).order_by(Game.updated_at.desc()).limit(20).all()
    challenges = Challenge.query.filter_by(receiver_id=current_user.id, status="pending").all()
    users = User.query.filter(User.id != current_user.id).order_by(User.rating.desc()).limit(30).all()
    return render_template("dashboard.html", games=games, challenges=challenges, users=users)


@app.post("/game/bot")
@login_required
def create_bot_game():
    level = request.form.get("level", "medium")
    game = Game(white_id=current_user.id, mode="bot", bot_level=level)
    db.session.add(game); db.session.commit()
    return redirect(url_for("game_page", game_id=game.id))


@app.post("/challenge/<int:user_id>")
@login_required
def challenge(user_id):
    if user_id != current_user.id and db.session.get(User, user_id):
        db.session.add(Challenge(sender_id=current_user.id, receiver_id=user_id))
        db.session.commit()
    return redirect(url_for("dashboard"))


@app.post("/challenge/<int:challenge_id>/accept")
@login_required
def accept_challenge(challenge_id):
    challenge = db.session.get(Challenge, challenge_id)
    if not challenge or challenge.receiver_id != current_user.id or challenge.status != "pending":
        return redirect(url_for("dashboard"))
    challenge.status = "accepted"
    game = Game(white_id=challenge.sender_id, black_id=challenge.receiver_id, mode="online")
    db.session.add(game); db.session.commit()
    return redirect(url_for("game_page", game_id=game.id))


@app.route("/game/<int:game_id>")
@login_required
def game_page(game_id):
    game = db.session.get(Game, game_id)
    if not game or not user_can_access(game):
        return redirect(url_for("dashboard"))
    return render_template("game.html", game=game)


@app.get("/api/game/<int:game_id>")
@login_required
def game_state(game_id):
    game = db.session.get(Game, game_id)
    if not game or not user_can_access(game):
        return jsonify({"error": "Нет доступа"}), 403
    board = chess.Board(game.fen)
    return jsonify({"fen": game.fen, "turn": "white" if board.turn else "black", "status": game.status,
                    "result": game.result, "legal": [m.uci() for m in board.legal_moves]})


@app.post("/api/game/<int:game_id>/move")
@login_required
def make_move(game_id):
    game = db.session.get(Game, game_id)
    if not game or not user_can_access(game) or game.status != "active":
        return jsonify({"error": "Ход невозможен"}), 400
    board = chess.Board(game.fen)
    expected_user = game.white_id if board.turn else game.black_id
    if game.mode == "online" and current_user.id != expected_user:
        return jsonify({"error": "Сейчас ход соперника"}), 400
    if game.mode == "bot" and not board.turn:
        return jsonify({"error": "Сейчас ход бота"}), 400
    try:
        move = chess.Move.from_uci(request.json.get("move", ""))
    except ValueError:
        return jsonify({"error": "Неверный формат хода"}), 400
    if move not in board.legal_moves:
        return jsonify({"error": "Недопустимый ход"}), 400
    board.push(move)
    game.moves = (game.moves + " " + move.uci()).strip()
    game.fen = board.fen()
    finish_game(game, board)
    db.session.commit()

    if game.mode == "bot" and game.status == "active":
        bot_move = choose_bot_move(board, game.bot_level)
        if bot_move:
            board.push(bot_move)
            game.moves = (game.moves + " " + bot_move.uci()).strip()
            game.fen = board.fen()
            finish_game(game, board)
            db.session.commit()
    socketio.emit("game_updated", {"game_id": game.id}, room=f"game_{game.id}")
    return jsonify({"ok": True, "fen": game.fen, "status": game.status, "result": game.result})


@socketio.on("join_game")
def on_join(data):
    if current_user.is_authenticated:
        join_room(f"game_{int(data['game_id'])}")
        emit("joined", {"ok": True})


@app.context_processor
def inject_helpers():
    return {"get_user": lambda uid: db.session.get(User, uid) if uid else None}


with app.app_context():
    db.create_all()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)
