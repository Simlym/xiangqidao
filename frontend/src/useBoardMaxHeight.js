import React from "react";

// 棋盘可用高度：从棋盘区顶部到可用区底部（移动端固定底栏顶边 / 视口底）的剩余空间，
// 避免全宽棋盘在窄高屏上把坐标行/控件挤出视口。结果传给 <Board maxHeight>，
// 它按宽、高取较小缩放。
//
// 用回调 ref：对弈/复盘的棋盘区是「开局/选中棋局后」才挂载的，普通 useEffect 首次
// 渲染拿到的 ref 是空的、之后不再重测。回调 ref 在节点真正挂载（含后挂载）时触发。
//
// 测量必须对移动端的「动态视口」鲁棒，否则会出现「刚进页面棋盘偏大溢出、缩放后又留白」：
//  - pinch-zoom 改变 visualViewport → 监听 visualViewport 的 resize/scroll 重测；
//  - 地址栏显隐、字体/工具栏换行等回流在挂载后才落定 → rAF + 延时各补测一次，
//    并用 ResizeObserver 观察整页（document.body）高度变化（棋盘上方内容变高会改变
//    棋盘顶部位置，只观察棋盘区自身是测不到的）。
//
// reserveBottom 棋盘下方需常驻可见的控件高度（如导航按钮），从可用高度中再扣除。
// mobileReserve 移动端（底栏固定）专用的扣除高度——棋盘下方往往还要露出解题卡/操作区，
//   需比 PC 留更多空间；不传则与 reserveBottom 一致。
// 返回 [measureRef, maxHeight]：把 measureRef 挂到棋盘区容器的 ref 上。
export function useBoardMaxHeight(reserveBottom = 12, mobileReserve = reserveBottom) {
  const [maxHeight, setMaxHeight] = React.useState(null);
  const cleanupRef = React.useRef(null);
  const measuredRef = React.useRef(false); // 是否已测得过有效高度

  const measureRef = React.useCallback((el) => {
    // 节点卸载或更换时，先清理上一次的监听
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    measuredRef.current = false;
    if (!el) return;

    const update = () => {
      // 仅在页面回到顶部时测量：一旦向下滚动，el.top 会随滚动变化，移动端地址栏显隐
      // 又会改变可用高度，二者叠加会让棋盘「边滚边忽大忽小」。锁定在顶部测一次后，
      // 滚动过程中保持不变（首次尚未测得时仍允许测量，避免挂载时已滚动而拿不到值）。
      if (measuredRef.current && window.scrollY > 8) return;

      const top = el.getBoundingClientRect().top;
      // 移动端底部导航栏是 position:fixed，会盖住棋盘下沿——以它的「实际渲染顶边」为
      // 可用区底界（已含地址栏/缩放的影响）；非固定（PC）时退回 visualViewport/视口底。
      let bottomLimit, reserve;
      const nav = document.querySelector("header nav");
      if (nav && getComputedStyle(nav).position === "fixed") {
        bottomLimit = nav.getBoundingClientRect().top;
        reserve = mobileReserve;
      } else {
        bottomLimit = window.visualViewport?.height ?? window.innerHeight;
        reserve = reserveBottom;
      }
      setMaxHeight(Math.max(120, bottomLimit - top - reserve));
      measuredRef.current = true;
    };

    // 初次测 + 回流落定后补测（移动端地址栏/换行常在挂载后才稳定）
    update();
    const raf = requestAnimationFrame(update);
    const timer = setTimeout(update, 250);

    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(document.body); // 上方内容变高 → 棋盘顶部位置变化，需重测
    window.addEventListener("resize", update);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", update);   // 缩放 / 地址栏显隐
    // 注意：不监听 visualViewport 的 scroll —— 否则滚动页面（如复盘）时棋盘顶部
    // 位置随滚动变化会被反复重算，棋盘边滚边变大小。

    cleanupRef.current = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener("resize", update);
      vv?.removeEventListener("resize", update);
    };
  }, [reserveBottom, mobileReserve]);

  return [measureRef, maxHeight];
}
