import fs from "fs";
const cg = "node_modules/@lichess-org/chessground/assets/";
const css = ["chessground.base.css", "chessground.brown.css", "chessground.cburnett.css"].map((f) => fs.readFileSync(cg + f, "utf8")).join("\n")
          + "\n" + fs.readFileSync("src/app.css", "utf8");
fs.writeFileSync("style.css", css);
console.log("style.css", (css.length / 1024).toFixed(0) + " KB");
