const boardEl = document.getElementById("board");
const gameId = boardEl.dataset.game;

let selected = null;
let legal = [];

/* Профессиональные изображения фигур */
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

function parseFen(fen) {
    const rows = fen.split(" ")[0].split("/");
    const map = {};

    rows.forEach((row, rowIndex) => {
        let fileIndex = 0;

        for (const symbol of row) {
            if (/\d/.test(symbol)) {
                fileIndex += Number(symbol);
            } else {
                const square =
                    "abcdefgh"[fileIndex] + (8 - rowIndex);

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
            const squareName =
                "abcdefgh"[fileIndex] + rank;

            const pieceCode = map[squareName];

            const square = document.createElement("div");

            square.className =
                "square " +
                ((fileIndex + rank) % 2 ? "light" : "dark");

            square.dataset.sq = squareName;

            /* Координаты доски */

            if (fileIndex === 0) {
                const rankLabel =
                    document.createElement("span");

                rankLabel.className = "rank-label";
                rankLabel.textContent = rank;

                square.appendChild(rankLabel);
            }

            if (rank === 1) {
                const fileLabel =
                    document.createElement("span");

                fileLabel.className = "file-label";
                fileLabel.textContent =
                    "abcdefgh"[fileIndex];

                square.appendChild(fileLabel);
            }

            /* Фигура */

            if (pieceCode) {
                const piece =
                    document.createElement("img");

                piece.src = pieces[pieceCode];
                piece.alt = pieceCode;

                piece.draggable = false;

                piece.className =
                    pieceCode === pieceCode.toUpperCase()
                        ? "chess-piece white-piece"
                        : "chess-piece black-piece";

                square.appendChild(piece);
            }

            if (selected === squareName) {
                square.classList.add("selected");
            }

            if (
                selected &&
                legal.some((move) =>
                    move.startsWith(
                        selected + squareName
                    )
                )
            ) {
                square.classList.add("legal");
            }

            square.onclick = () =>
                clickSquare(squareName, pieceCode);

            boardEl.appendChild(square);
        }
    }

    const status =
        document.getElementById("status");

    if (data.status === "finished") {
        if (data.result === "1-0") {
            status.textContent =
                "Партия окончена — белые победили";
        } else if (data.result === "0-1") {
            status.textContent =
                "Партия окончена — чёрные победили";
        } else {
            status.textContent =
                "Партия окончена — ничья";
        }
    } else {
        status.textContent =
            data.turn === "white"
                ? "Ход белых — сейчас ваш ход"
                : "Ход чёрных — бот думает";
    }
}

async function load() {
    try {
        const response =
            await fetch(`/api/game/${gameId}`);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Ошибка загрузки партии"
            );
        }

        render(data);
    } catch (error) {
        console.error(error);

        document.getElementById("status").textContent =
            "Не удалось загрузить партию";
    }
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

    if (
        promotions.length &&
        promotions[0].length === 5
    ) {
        move += "q";
    }

    if (!legal.includes(move)) {
        selected = pieceCode ? squareName : null;
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
                body: JSON.stringify({ move })
            }
        );

        const data = await response.json();

        if (!response.ok) {
            alert(
                data.error ||
                "Ошибка выполнения хода"
            );
        }
    } catch (error) {
        console.error(error);
        alert("Не удалось выполнить ход");
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