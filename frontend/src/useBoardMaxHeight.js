import React from "react";

// 棋盘可用高度：从棋盘区顶部到可用区底部的剩余空间，避免全宽棋盘在窄高屏上
// 把坐标行/控件挤出视口。把结果传给 <Board maxHeight>，它会按宽、高取较小缩放。
//
// 注意：不能用棋盘区自身的 clientHeight 当上限——它由棋盘内容撑高，会形成
// 「越量越大」的循环，起不到限高作用。这里用「视口（或固定底栏顶边）− 棋盘区顶部」。
//
// 用回调 ref 而非 useRef：对弈/复盘的棋盘区是「开局/选中棋局后」才挂载的，
// 普通 useEffect 在首次渲染时拿到的 ref 还是空的、之后不再重测。回调 ref 在节点
// 真正挂载（含后挂载）时触发，保证测量一定发生。
//
// reserveBottom 棋盘下方需常驻可见的控件高度（如导航按钮），从可用高度中再扣除
// 返回 [measureRef, maxHeight]：把 measureRef 挂到棋盘区容器的 ref 上。
export function useBoardMaxHeight(reserveBottom = 12) {
  const [maxHeight, setMaxHeight] = React.useState(null);
  const cleanupRef = React.useRef(null);

  const measureRef = React.useCallback((el) => {
    // 节点卸载或更换时，先清理上一次的监听
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      // 移动端底部导航栏是 position:fixed，会盖住棋盘下沿——以它的顶边作为可用区
      // 底界；非固定（PC）时退回视口底部。
      let bottomLimit = window.innerHeight;
      const nav = document.querySelector("header nav");
      if (nav && getComputedStyle(nav).position === "fixed") {
        bottomLimit = nav.getBoundingClientRect().top;
      }
      setMaxHeight(Math.max(120, bottomLimit - top - reserveBottom));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    cleanupRef.current = () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [reserveBottom]);

  return [measureRef, maxHeight];
}
