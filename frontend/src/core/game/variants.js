import * as xiangqi from "../../xiangqi";

export const VARIANT_IDS = Object.freeze({
  XIANGQI: "xiangqi",
  JIEQI: "jieqi",
});

// 棋类能力注册表。第一阶段只注册现有象棋实现；揭棋迁入时实现相同契约。
const variants = {
  [VARIANT_IDS.XIANGQI]: Object.freeze({
    id: VARIANT_IDS.XIANGQI,
    name: "象棋",
    initialFen: xiangqi.INITIAL_FEN,
    parseFen: xiangqi.parseFen,
    applyMove: xiangqi.applyMove,
    formatMove: xiangqi.uciToChinese,
  }),
};

export function getGameVariant(id = VARIANT_IDS.XIANGQI) {
  const variant = variants[id];
  if (!variant) throw new Error(`尚未支持棋类：${id}`);
  return variant;
}

export function listGameVariants() {
  return Object.values(variants);
}

