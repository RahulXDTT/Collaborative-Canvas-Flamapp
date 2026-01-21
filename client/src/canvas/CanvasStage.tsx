// client/src/canvas/CanvasStage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { roomStore } from "../state/roomStore";
import { realtime } from "../net/socket";
import type { Tool } from "../net/protocol";
import {
  clamp,
  drawCursors,
  drawStrokeSmooth,
  redrawBaseFromStrokes,
  redrawLive,
  screenToWorld,
  applyViewportTransform,
  resetTransform,
  type Viewport,
  type Point
} from "./drawEngine";

type Props = {
  tool: Tool;
  color: string;
  width: number;
};

type CursorMap = Map<string, { x: number; y: number }>;

function useRoomTick() {
  const [, setTick] = useState(0);
  useEffect(() => roomStore.subscribe(() => setTick((t) => t + 1)), []);
}

export default function CanvasStage({ tool, color, width }: Props) {
  useRoomTick();
  const room = roomStore.getState();

  const containerRef = useRef<HTMLDivElement | null>(null);

  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const uiRef = useRef<HTMLCanvasElement | null>(null);

  const baseCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const liveCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const uiCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // viewport (Excalidraw-ish)
  const [vp, setVp] = useState<Viewport>({ panX: 0, panY: 0, scale: 1 });

  // panning
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const spaceDownRef = useRef(false);

  // drawing state
  const isDrawingRef = useRef(false);
  const activeStrokeIdRef = useRef<string | null>(null);
  const lastPointRef = useRef<Point | null>(null);

  // batching points
  const batchRef = useRef<Point[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  // remote cursors (screen coords)
  const cursorsRef = useRef<CursorMap>(new Map());
  const lastCursorSentRef = useRef<{ x: number; y: number; ts: number } | null>(null);

  const committedStrokes = useMemo(() => Array.from(room.strokes.values()), [room.strokes, room.seq]);
  const inProgressStrokes = useMemo(() => Array.from(room.inProgress.values()), [room.inProgress, room.seq]);

  // init canvases + resize
  useEffect(() => {
    const base = baseRef.current;
    const live = liveRef.current;
    const ui = uiRef.current;
    if (!base || !live || !ui) return;

    baseCtxRef.current = base.getContext("2d");
    liveCtxRef.current = live.getContext("2d");
    uiCtxRef.current = ui.getContext("2d");

    const resize = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor(rect.width * dpr);
      const h = Math.floor(rect.height * dpr);

      for (const c of [base, live, ui]) {
        c.width = w;
        c.height = h;
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
      }

      requestAnimationFrame(() => renderAll());
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // listen to cursor events
  useEffect(() => {
    const onCursor = (ev: Event) => {
      const e = ev as CustomEvent<{ userId: string; x: number; y: number }>;
      const { userId, x, y } = e.detail;
      cursorsRef.current.set(userId, { x, y });
      renderAll();
    };
    window.addEventListener("rt_cursor", onCursor);
    return () => window.removeEventListener("rt_cursor", onCursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.roomId]);

  // Key handling: Space to pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = true;
        if (containerRef.current) containerRef.current.classList.add("panningCursor");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = false;
        if (containerRef.current) containerRef.current.classList.remove("panningCursor");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Re-render on state changes
  useEffect(() => {
    renderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.seq, vp, room.roomId]);

  function renderAll() {
    const baseCtx = baseCtxRef.current;
    const liveCtx = liveCtxRef.current;
    const uiCtx = uiCtxRef.current;
    if (!baseCtx || !liveCtx || !uiCtx) return;

    console.log("renderAll:", { committedStrokesCount: committedStrokes.length, inProgressCount: inProgressStrokes.length, roomStrokesCount: room.strokes.size });
    redrawBaseFromStrokes(baseCtx, vp, committedStrokes, room.undone);
    redrawLive(liveCtx, vp, inProgressStrokes);

    // For active shape preview, only draw if not already in room state
    if (isDrawingRef.current && batchRef.current.length >= 2 && 
        (tool === "rectangle" || tool === "circle" || tool === "square")) {
      const activeStrokeId = activeStrokeIdRef.current;
      // Only draw preview if this stroke isn't already in inProgressStrokes
      if (!activeStrokeId || !room.inProgress.has(activeStrokeId)) {
        applyViewportTransform(liveCtx, vp);
        drawStrokeSmooth(liveCtx, {
          tool,
          color,
          w: width,
          points: batchRef.current
        });
        resetTransform(liveCtx);
      }
    }

    const users = room.users;
    const cursorsArr: Array<{ x: number; y: number; color: string; name: string }> = [];
    for (const [uid, pos] of cursorsRef.current.entries()) {
      const u = users.get(uid);
      if (!u) continue;
      cursorsArr.push({ x: pos.x, y: pos.y, color: u.color, name: u.name });
    }
    drawCursors(uiCtx, cursorsArr);
  }

  // Zoom to cursor (Excalidraw feel)
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const sx = (e.clientX - rect.left) * dpr;
    const sy = (e.clientY - rect.top) * dpr;

    const delta = -e.deltaY;
    const zoomFactor = delta > 0 ? 1.08 : 1 / 1.08;

    setVp((prev) => {
      const nextScale = clamp(prev.scale * zoomFactor, 0.2, 4);

      const wx = (sx - prev.panX) / prev.scale;
      const wy = (sy - prev.panY) / prev.scale;

      const nextPanX = sx - wx * nextScale;
      const nextPanY = sy - wy * nextScale;

      return { panX: nextPanX, panY: nextPanY, scale: nextScale };
    });
  }

  function beginPan(screenX: number, screenY: number) {
    isPanningRef.current = true;
    panStartRef.current = { x: screenX, y: screenY, panX: vp.panX, panY: vp.panY };
  }

  function movePan(screenX: number, screenY: number) {
    const start = panStartRef.current;
    if (!start) return;
    const dx = screenX - start.x;
    const dy = screenY - start.y;
    setVp((prev) => ({ ...prev, panX: start.panX + dx, panY: start.panY + dy }));
  }

  function endPan() {
    isPanningRef.current = false;
    panStartRef.current = null;
  }

  function startStroke(world: Point) {
    if (!room.roomId) return;
    if (room.selfUserId == null) return;

    const strokeId = `${room.selfUserId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    activeStrokeIdRef.current = strokeId;
    isDrawingRef.current = true;
    lastPointRef.current = world;
    batchRef.current = [world];

    console.log("Starting stroke with tool:", tool, "at", world);

    realtime.sendOp({
      t: "stroke_start",
      strokeId,
      tool,
      color,
      w: width,
      x: world[0],
      y: world[1]
    });

    // Only schedule flush for brush/eraser, not shapes
    // Shapes will be sent complete on stroke_end
    if (tool !== "rectangle" && tool !== "circle" && tool !== "square") {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPoints();
      if (isDrawingRef.current) scheduleFlush();
    }, 16);
  }

  function flushPoints() {
    const strokeId = activeStrokeIdRef.current;
    if (!strokeId) return;
    const pts = batchRef.current;
    if (pts.length <= 1) return;
    const payload = pts.slice(1);
    batchRef.current = [pts[pts.length - 1]];
    realtime.sendOp({ t: "stroke_points", strokeId, pts: payload });
  }

  function extendStroke(world: Point) {
    const last = lastPointRef.current;
    if (!last) return;

    // For shapes, update the end point in batch
    if (tool === "rectangle" || tool === "circle" || tool === "square") {
      lastPointRef.current = world;
      batchRef.current = [batchRef.current[0], world]; // Keep only start and current end
      console.log("Shape points:", batchRef.current);
      renderAll();
      return;
    }

    // For brush/eraser, only add point if far enough away
    if (distWorld(last, world) < 0.8) return;

    lastPointRef.current = world;
    batchRef.current.push(world);

    renderAll();
  }

  function endStroke() {
    const strokeId = activeStrokeIdRef.current;
    if (!strokeId) return;

    // For shapes, send the complete shape with end point
    if (tool === "rectangle" || tool === "circle" || tool === "square") {
      let pts = batchRef.current;
      console.log("Ending shape stroke:", { strokeId, tool, ptsLength: pts.length, pts });
      
      // If only 1 point (user clicked without dragging), duplicate it to create degenerate shape
      if (pts.length === 1) {
        pts = [pts[0], pts[0]];
        console.log("Shape had only 1 point, duplicating:", pts);
      }
      
      if (pts.length >= 2) {
        // Send only the end point (start was sent in stroke_start)
        console.log("Sending stroke_points for shape:", { strokeId, endPoint: pts[1] });
        realtime.sendOp({ t: "stroke_points", strokeId, pts: [pts[1]] });
      }
    } else {
      // For brush/eraser, flush any remaining points
      flushPoints();
    }

    console.log("Sending stroke_end:", strokeId);
    realtime.sendOp({ t: "stroke_end", strokeId });

    activeStrokeIdRef.current = null;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    batchRef.current = [];

    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }

  function distWorld(a: Point, b: Point) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handlePointerDown(e: React.PointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    if (!room.roomId) return;

    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sx = (e.clientX - rect.left) * dpr;
    const sy = (e.clientY - rect.top) * dpr;

    const isMiddle = e.button === 1;
    const isSpacePan = spaceDownRef.current && e.button === 0;

    if (isMiddle || isSpacePan) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      beginPan(sx, sy);
      return;
    }

    if (e.button !== 0) return;

    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const world = screenToWorld(sx, sy, vp);
    startStroke(world);
  }

  function maybeSendCursor(sx: number, sy: number) {
    const now = performance.now();
    const last = lastCursorSentRef.current;
    if (!last) {
      lastCursorSentRef.current = { x: sx, y: sy, ts: now };
      realtime.sendCursor(sx, sy);
      return;
    }

    const dx = sx - last.x;
    const dy = sy - last.y;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const dt = now - last.ts;

    if (moved < 2 && dt < 25) return;

    lastCursorSentRef.current = { x: sx, y: sy, ts: now };
    realtime.sendCursor(sx, sy);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    if (!room.roomId) return;

    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sx = (e.clientX - rect.left) * dpr;
    const sy = (e.clientY - rect.top) * dpr;

    maybeSendCursor(sx, sy);

    if (isPanningRef.current) {
      movePan(sx, sy);
      return;
    }

    if (!isDrawingRef.current) return;

    const world = screenToWorld(sx, sy, vp);
    extendStroke(world);
  }

  function handlePointerUp() {
    if (isPanningRef.current) {
      endPan();
      return;
    }
    if (isDrawingRef.current) {
      endStroke();
    }
  }

  function handlePointerCancel() {
    if (isPanningRef.current) endPan();
    if (isDrawingRef.current) endStroke();
  }

  function resetView() {
    setVp({ panX: 0, panY: 0, scale: 1 });
  }

  const zoomPercent = Math.round(vp.scale * 100);
  const me = room.users.get(room.selfUserId ?? "");
  const canDraw = (me?.mode ?? "edit") !== "view";

  return (
    <div className="canvasWrap">
      <div
        ref={containerRef}
        className="canvasStage"
        onWheel={handleWheel}
        onDoubleClick={resetView}
        onPointerDown={
          canDraw
            ? handlePointerDown
            : (e) => {
                if (e.button === 1 || (spaceDownRef.current && e.button === 0)) handlePointerDown(e);
              }
        }
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <canvas ref={baseRef} className="layer layerBase" />
        <canvas ref={liveRef} className="layer layerLive" />
        <canvas ref={uiRef} className="layer layerUi" />

        <div className="hud">
          <div className="hudItem">Zoom: {zoomPercent}%</div>
          <div className="hudItem">Pan: Space+Drag / Middle Mouse</div>
          <div className="hudItem">Reset: Double Click</div>
          {!canDraw ? <div className="hudItem">View Mode</div> : null}
        </div>
      </div>
    </div>
  );
}
