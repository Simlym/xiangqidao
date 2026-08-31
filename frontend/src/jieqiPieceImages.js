import blackAdvisor from "./assets/jieqi/black_advisor.svg";
import blackCannon from "./assets/jieqi/black_cannon.svg";
import blackChariot from "./assets/jieqi/black_chariot.svg";
import blackElephant from "./assets/jieqi/black_elephant.svg";
import blackHorse from "./assets/jieqi/black_horse.svg";
import blackKing from "./assets/jieqi/black_king.svg";
import blackPawn from "./assets/jieqi/black_pawn.svg";
import darkPiece from "./assets/jieqi/dark_piece.svg";
import redAdvisor from "./assets/jieqi/red_advisor.svg";
import redCannon from "./assets/jieqi/red_cannon.svg";
import redChariot from "./assets/jieqi/red_chariot.svg";
import redElephant from "./assets/jieqi/red_elephant.svg";
import redHorse from "./assets/jieqi/red_horse.svg";
import redKing from "./assets/jieqi/red_king.svg";
import redPawn from "./assets/jieqi/red_pawn.svg";

const roleNames = {
  A: "advisor",
  C: "cannon",
  R: "chariot",
  B: "elephant",
  N: "horse",
  K: "king",
  P: "pawn",
};

const images = {
  black_advisor: blackAdvisor,
  black_cannon: blackCannon,
  black_chariot: blackChariot,
  black_elephant: blackElephant,
  black_horse: blackHorse,
  black_king: blackKing,
  black_pawn: blackPawn,
  red_advisor: redAdvisor,
  red_cannon: redCannon,
  red_chariot: redChariot,
  red_elephant: redElephant,
  red_horse: redHorse,
  red_king: redKing,
  red_pawn: redPawn,
};

export function jieqiPieceImage(cell) {
  if (!cell || cell.hidden) return darkPiece;
  const side = cell.red ? "red" : "black";
  return images[`${side}_${roleNames[cell.piece.toUpperCase()]}`] || darkPiece;
}
