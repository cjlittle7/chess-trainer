import fs from "fs";
const cg = "node_modules/@lichess-org/chessground/assets/";
let css = ["chessground.base.css", "chessground.brown.css", "chessground.cburnett.css"].map((f) => fs.readFileSync(cg + f, "utf8")).join("\n")
        + "\n" + fs.readFileSync("src/app.css", "utf8");

// Extra board colours: class "brd-<name>" on <body>. light = light squares, dark = dark squares.
const BOARDS = {
  green: ["#eeeed2", "#769656"], blue: ["#dee3e6", "#8ca2ad"], gray: ["#e4e4e4", "#9a9a9a"],
  purple: ["#efe9f4", "#9f8fb3"], night: ["#9aa0a6", "#4d5560"],
};
css += "\n/* board themes */\n";
for (const [name, [light, dark]] of Object.entries(BOARDS)) {
  let rects = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) rects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><g fill="${dark}">${rects}</g></svg>`;
  css += `body.brd-${name} cg-board { background-color:${light}; background-image:url('data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}'); }\n`;
}

// Extra piece sets (see assets/pieces/CREDITS.md): class "pcs-<name>" on <body>.
const ROLES = { K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn" };
css += "\n/* piece sets */\n";
for (const set of fs.readdirSync("assets/pieces").filter((d) => fs.statSync("assets/pieces/" + d).isDirectory())) {
  for (const [letter, role] of Object.entries(ROLES)) for (const [c, color] of [["w", "white"], ["b", "black"]]) {
    const b64 = fs.readFileSync(`assets/pieces/${set}/${c}${letter}.svg`).toString("base64");
    css += `body.pcs-${set} .cg-wrap piece.${role}.${color} { background-image:url('data:image/svg+xml;base64,${b64}'); }\n`;
  }
}
fs.writeFileSync("style.css", css);
console.log("style.css", (css.length / 1024).toFixed(0) + " KB");
