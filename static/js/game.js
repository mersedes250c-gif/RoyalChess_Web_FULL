const boardEl = document.getElementById("board");
const gameId = boardEl.dataset.game;

let selected = null;
let legal = [];
let lastFen = null;
let initialLoad = true;
let finishedResult = null;
let audioContext = null;

const pieces = {
    P: "https://chessboardjs.com/img/chesspieces/wikipedia/wP.png",
    N: "https://chessboardjs.com/img/chesspieces/wikipedia/wN.png",
    B: "https://chessboardjs.com/img/chesspieces/wikipedia/wB.png",
    R: "https://chessboardjs.com/img/chesspieces/wikipedia/wR.png",
    Q: "https://chessboardjs.com/img/chesspieces/wikipedia/wQ.png",
    K: "https://chessboardjs.com/img/chesspieces/wikipedia/wK.png",

    p: "https://chessboardjs.com/img/chesspieces/wikipedia/bP.png",
    n: "https://chessboardjs.com/img/chesspieces/wikipedia/bN.png",
    b: "https://chessboardjs.com/img/chesspieces/wikipedia/bB.png",
    r: "https://chessboardjs.com/img/chesspieces/wikipedia/bR.png",
    q: "https://chessboardjs.com/img/chesspieces/wikipedia/bQ.png",
    k: "https://chessboardjs.com/img/chesspieces/wikipedia/bK.png"
};

/* =========================
   ЗВУКИ
   ========================= */

function getAudioContext() {
    if (!audioContext) {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            return null;
        }

        audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    return audioContext;
}

function playTone(
    frequency,
    duration,
    type = "sine",
    volume = 0.08,
    delay = 0
) {
    try {
        const context = getAudioContext();

        if (!context) {
            return;
        }

        const oscillator = context.createOscillator();
        const gain = context.createGain();

        const startTime = context.currentTime + delay;
        const endTime = startTime + duration;

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startTime);

        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(
            volume,
            startTime + 0.012
        );
        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            endTime
        );

        oscillator.connect(gain);
        gain.connect(context.destination);

        oscillator.start(startTime);
        oscillator.stop(endTime + 0.03);
    } catch (error) {
        console.log("Звук недоступен:", error);
    }
}

function playSelectSound() {
    playTone(720, 0.05, "sine", 0.04);
}

function playMoveSound() {
    playTone(570, 0.07, "triangle", 0.08);
    playTone(390, 0.09, "sine", 0.05, 0.04);
}

function playErrorSound() {
    playTone(190, 0.12, "sawtooth", 0.06);
    playTone(140, 0.14, "sawtooth", 0.05, 0.07);
}

function playWinSound() {
    playTone(523, 0.13, "triangle", 0.08);
    playTone(659, 0.13, "triangle", 0.08, 0.13);
    playTone(784, 0.24, "triangle", 0.09, 0.26);
}

function playLoseSound() {
    playTone(330, 0.15, "sine", 0.07);
    playTone(247, 0.2, "sine", 0.07, 0.14);
}

function playDrawSound() {
    playTone(440, 0.13, "sine", 0.06);
    playTone(440, 0.13, "sine", 0.06, 0.16);
}

function playFinishSound(result) {
    if (result === "1-0") {
        playWinSound();
        return;
    }

    if (result === "0-1") {
        playLoseSound();
        return;
    }

    playDrawSound();
}

/* =========================
   ЧТЕНИЕ ПОЗИЦИИ FEN
   ========================= */

function parseFen(fen) {
    const boardPart = fen.split(" ")[0];
    const rows = boardPart.split("/");
    const position = {};

    rows.forEach((row, rowIndex) => {
        let fileIndex = 0;

        for (const symbol of row) {
            if (/\d/.test(symbol)) {
                fileIndex += Number(symbol);
                continue;
            }

            const file = "abcdefgh"[fileIndex];
            const rank = 8 - rowIndex;
            const squareName = file + rank;

            position[squareName] = symbol;
            fileIndex++;
        }
    });

    return position;
}

/* =========================
   СОЗДАНИЕ ФИГУРЫ
   ========================= */

function createPiece(pieceCode) {
    const piece = document.createElement("img");

    piece.src = pieces[pieceCode];
    piece.alt = pieceCode;
    piece.draggable = false;

    const isWhite =
        pieceCode === pieceCode.toUpperCase();

    piece.className = isWhite
        ? "chess-piece white-piece"
        : "chess-piece black-piece";

    return piece;
}

/* =========================
   КООРДИНАТЫ ДОСКИ
   ========================= */

function addCoordinates(square, fileIndex, rank) {
    if (fileIndex === 0) {
        const rankLabel = document.createElement("span");

        rankLabel.className = "rank-label";
        rankLabel.textContent = rank;

        square.appendChild(rankLabel);
    }

    if (rank === 1) {
        const fileLabel = document.createElement("span");

        fileLabel.className = "file-label";
        fileLabel.textContent = "abcdefgh"[fileIndex];

        square.appendChild(fileLabel);
    }
}

/* =========================
   СТАТУС ПАРТИИ
   ========================= */

function updateStatus(data) {
    const statusEl = document.getElementById("status");

    if (!statusEl) {
        return;
    }

    if (data.status === "finished") {
        if (data.result === "1-0") {
            statusEl.textContent =
                "Партия окончена — белые победили";
        } else if (data.result === "0-1") {
            statusEl.textContent =
                "Партия окончена — чёрные победили";
        } else {
            statusEl.textContent =
                "Партия окончена — ничья";
        }

        if (finishedResult !== data.result) {
            finishedResult = data.result;
            playFinishSound(data.result);
        }

        return;
    }

    finishedResult = null;

    statusEl.textContent =
        data.turn === "white"
            ? "Ход белых — сейчас ваш ход"
            : "Ход чёрных — бот думает";
}

/* =========================
   ОТРИСОВКА ДОСКИ
   ========================= */

function render(data) {
    legal = Array.isArray(data.legal)
        ? data.legal
        : [];

    const position = parseFen(data.fen);

    if (
        !initialLoad &&
        lastFen &&
        lastFen !== data.fen
    ) {
        playMoveSound();
    }

    lastFen = data.fen;
    initialLoad = false;

    boardEl.innerHTML = "";

    for (let rank = 8; rank >= 1; rank--) {
        for (
            let fileIndex = 0;
            fileIndex < 8;
            fileIndex++
        ) {
            const file = "abcdefgh"[fileIndex];
            const squareName = file + rank;
            const pieceCode = position[squareName];

            const square =
                document.createElement("div");

            const squareColor =
                (fileIndex + rank) % 2
                    ? "light"
                    : "dark";

            square.className =
                `square ${squareColor}`;

            square.dataset.sq = squareName;

            addCoordinates(
                square,
                fileIndex,
                rank
            );

            if (pieceCode) {
                const piece =
                    createPiece(pieceCode);

                square.appendChild(piece);
            }

            if (selected === squareName) {
                square.classList.add("selected");
            }

            const isLegalDestination =
                selected &&
                legal.some((move) =>
                    move.startsWith(
                        selected + squareName
                    )
                );

            if (isLegalDestination) {
                square.classList.add("legal");
            }

            square.addEventListener(
                "click",
                () => {
                    clickSquare(
                        squareName,
                        pieceCode
                    );
                }
            );

            boardEl.appendChild(square);
        }
    }

    updateStatus(data);
}

/* =========================
   ЗАГРУЗКА ПАРТИИ
   ========================= */

async function load() {
    try {
        const response = await fetch(
            `/api/game/${gameId}`,
            {
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error ||
                "Ошибка загрузки партии"
            );
        }

        render(data);
    } catch (error) {
        console.error(error);

        const statusEl =
            document.getElementById("status");

        if (statusEl) {
            statusEl.textContent =
                "Не удалось загрузить партию";
        }
    }
}

/* =========================
   НАЖАТИЕ НА КЛЕТКУ
   ========================= */

async function clickSquare(
    squareName,
    pieceCode
) {
    getAudioContext();

    if (!selected) {
        if (pieceCode) {
            selected = squareName;
            playSelectSound();
            await load();
        }

        return;
    }

    let move = selected + squareName;

    const promotionMoves = legal.filter(
        (legalMove) =>
            legalMove.startsWith(move)
    );

    if (
        promotionMoves.length > 0 &&
        promotionMoves[0].length === 5
    ) {
        move += "q";
    }

    if (!legal.includes(move)) {
        playErrorSound();

        selected = pieceCode
            ? squareName
            : null;

        await load();
        return;
    }

    try {
        const response = await fetch(
            `/api/game/${gameId}/move`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify({
                    move: move
                })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            playErrorSound();

            alert(
                data.error ||
                "Ошибка выполнения хода"
            );
        }
    } catch (error) {
        console.error(error);
        playErrorSound();

        alert(
            "Не удалось выполнить ход"
        );
    }

    selected = null;
    await load();
}

/* =========================
   SOCKET.IO
   ========================= */

const socket = io();

socket.emit("join_game", {
    game_id: Number(gameId)
});

socket.on(
    "game_updated",
    () => {
        load();
    }
);

/* Первый запуск */

load();