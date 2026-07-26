const boardEl = document.getElementById("board");
const gameId = boardEl.dataset.game;

let selected = null;
let legal = [];

const pieces = {
    P: "♙",
    N: "♘",
    B: "♗",
    R: "♖",
    Q: "♕",
    K: "♔",
    p: "♟",
    n: "♞",
    b: "♝",
    r: "♜",
    q: "♛",
    k: "♚"
};

function parseFen(fen) {
    const rows = fen.split(" ")[0].split("/");
    const map = {};

    rows.forEach((row, rowIndex) => {
        let fileIndex = 0;

        for (const symbol of row) {
            if (/\d/.test(symbol)) {
                fileIndex += Number(symbol);
            } else {
                const square = "abcdefgh"[fileIndex] + (8 - rowIndex);
                map[square] = symbol;
                fileIndex++;
            }
        }
    });

    return map;
}

function render(data) {
    legal = data.legal || [];
    const map = parseFen(data.fen);

    boardEl.innerHTML = "";

    for (let rank = 8; rank >= 1; rank--) {
        for (let fileIndex = 0; fileIndex < 8; fileIndex++) {
            const squareName = "abcdefgh"[fileIndex] + rank;
            const pieceCode = map[squareName];

            const square = document.createElement("div");

            square.className =
                "square " +
                ((fileIndex + rank) % 2 ? "light" : "dark");

            square.dataset.sq = squareName;

            if (pieceCode) {
                const piece = document.createElement("span");

                piece.className =
                    pieceCode === pieceCode.toUpperCase()
                        ? "chess-piece white-piece"
                        : "chess-piece black-piece";

                piece.textContent = pieces[pieceCode];
                square.appendChild(piece);
            }

            if (selected === squareName) {
                square.classList.add("selected");
            }

            if (
                selected &&
                legal.some((move) =>
                    move.startsWith(selected + squareName)
                )
            ) {
                square.classList.add("legal");
            }

            square.onclick = () =>
                clickSquare(squareName, pieceCode);

            boardEl.appendChild(square);
        }
    }

    const status = document.getElementById("status");

    if (data.status === "finished") {
        status.textContent = `Партия окончена: ${data.result}`;
    } else {
        status.textContent =
            data.turn === "white"
                ? "Ход белых — сейчас ваш ход"
                : "Ход чёрных — соперник думает";
    }
}

async function load() {
    const response = await fetch(`/api/game/${gameId}`);
    const data = await response.json();
    render(data);
}

async function clickSquare(squareName, pieceCode) {
    if (!selected) {
        if (pieceCode) {
            selected = squareName;
            await load();
        }

        return;
    }

    let move = selected + squareName;

    const promotions = legal.filter((item) =>
        item.startsWith(move)
    );

    if (promotions.length && promotions[0].length === 5) {
        move += "q";
    }

    if (!legal.includes(move)) {
        selected = pieceCode ? squareName : null;
        await load();
        return;
    }

    const response = await fetch(
        `/api/game/${gameId}/move`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ move })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        alert(data.error || "Ошибка выполнения хода");
    }

    selected = null;
    await load();
}

const socket = io();

socket.emit("join_game", {
    game_id: Number(gameId)
});

socket.on("game_updated", load);

load();