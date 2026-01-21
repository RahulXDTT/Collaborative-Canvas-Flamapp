// client/src/canvas/drawEngine.ts
import type { StrokeRecord, Tool } from "../net/protocol";

export type Viewport = {
  panX: number;
  panY: number;
  scale: number;
};

export type ToolStyle = {
  tool: Tool;
  color: string;
  width: number;
};

export type Point = [number, number];

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function dist(a: Point, b: Point) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

// Convert screen coords -> world coords using viewport transform
export function screenToWorld(x: number, y: number, vp: Viewport): Point {
  return [(x - vp.panX) / vp.scale, (y - vp.panY) / vp.scale];
}

// Convert world coords -> screen coords
export function worldToScreen(p: Point, vp: Viewport): Point {
  return [p[0] * vp.scale + vp.panX, p[1] * vp.scale + vp.panY];
}

export function applyViewportTransform(ctx: CanvasRenderingContext2D, vp: Viewport) {
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.panX, vp.panY);
}

export function resetTransform(ctx: CanvasRenderingContext2D) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function setupCtxForTool(ctx: CanvasRenderingContext2D, tool: Tool, color: string, width: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "rgba(0,0,0,1)";
  } else if (tool === "rectangle" || tool === "circle" || tool === "square") {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = color;
  }
}

// Smooth stroke drawing using quadratic curves.
// Expects points in WORLD coordinates; viewport transform must be applied before calling.
export function drawStrokeSmooth(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<StrokeRecord, "tool" | "color" | "w" | "points">
) {
  const pts = stroke.points;
  if (pts.length === 0) return;

  // Handle shape tools
  if (stroke.tool === "rectangle" || stroke.tool === "circle" || stroke.tool === "square") {
    if (pts.length < 2) return; // Need at least 2 points to draw shape
    
    setupCtxForTool(ctx, stroke.tool, stroke.color, stroke.w);
    
    const x1 = pts[0][0];
    const y1 = pts[0][1];
    const x2 = pts[pts.length - 1][0];
    const y2 = pts[pts.length - 1][1];
    
    ctx.beginPath();
    
    if (stroke.tool === "rectangle") {
      const width = x2 - x1;
      const height = y2 - y1;
      ctx.rect(x1, y1, width, height);
    } else if (stroke.tool === "square") {
      const size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      const signX = x2 >= x1 ? 1 : -1;
      const signY = y2 >= y1 ? 1 : -1;
      ctx.rect(x1, y1, size * signX, size * signY);
    } else if (stroke.tool === "circle") {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const cx = x1;
      const cy = y1;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    }
    
    ctx.stroke();
    return;
  }

  setupCtxForTool(ctx, stroke.tool, stroke.color, stroke.w);

  // single point => draw dot
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], stroke.w / 2, 0, Math.PI * 2);
    ctx.fillStyle = (stroke.tool === "eraser") ? "rgba(0,0,0,1)" : stroke.color;
    // For eraser dot, destination-out works with fill too
    if (stroke.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
    else ctx.globalCompositeOperation = "source-over";
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);

  for (let i = 1; i < pts.length - 1; i++) {
    const cx = pts[i][0];
    const cy = pts[i][1];
    const nx = (pts[i][0] + pts[i + 1][0]) / 2;
    const ny = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(cx, cy, nx, ny);
  }

  // last segment
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);

  ctx.stroke();
}

// Efficient rebuild: clear base and redraw committed strokes that are not undone
export function redrawBaseFromStrokes(
  baseCtx: CanvasRenderingContext2D,
  vp: Viewport,
  strokes: StrokeRecord[],
  undone: Set<string>
) {
  resetTransform(baseCtx);
  baseCtx.clearRect(0, 0, baseCtx.canvas.width, baseCtx.canvas.height);

  applyViewportTransform(baseCtx, vp);

  console.log("redrawBaseFromStrokes:", { totalStrokes: strokes.length, committedCount: strokes.filter(s => s.committed).length, undoneCount: undone.size });
  for (const s of strokes) {
    console.log("Checking stroke:", { id: s.id, tool: s.tool, committed: s.committed, undone: undone.has(s.id), ptsLength: s.points.length });
    if (!s.committed) {
      console.log("Skipping non-committed stroke:", s.id);
      continue;
    }
    if (undone.has(s.id)) {
      console.log("Skipping undone stroke:", s.id);
      continue;
    }
    drawStrokeSmooth(baseCtx, s);
  }

  // restore default composite for safety
  baseCtx.globalCompositeOperation = "source-over";
}

// For live layer: clear and redraw in-progress strokes (including your own)
export function redrawLive(
  liveCtx: CanvasRenderingContext2D,
  vp: Viewport,
  inProgress: StrokeRecord[]
) {
  resetTransform(liveCtx);
  liveCtx.clearRect(0, 0, liveCtx.canvas.width, liveCtx.canvas.height);

  applyViewportTransform(liveCtx, vp);

  for (const s of inProgress) {
    drawStrokeSmooth(liveCtx, s);
  }

  liveCtx.globalCompositeOperation = "source-over";
}

// UI: draw other users cursors in SCREEN coords
export function drawCursors(
  uiCtx: CanvasRenderingContext2D,
  cursors: Array<{ x: number; y: number; color: string; name: string }>
) {
  resetTransform(uiCtx);
  uiCtx.clearRect(0, 0, uiCtx.canvas.width, uiCtx.canvas.height);

  uiCtx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  uiCtx.textBaseline = "top";

  for (const c of cursors) {
    uiCtx.fillStyle = c.color;
    uiCtx.beginPath();
    uiCtx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    uiCtx.fill();

    // label background
    const padX = 6;
    const padY = 4;
    const text = c.name;
    const w = uiCtx.measureText(text).width;
    uiCtx.fillStyle = "rgba(0,0,0,0.65)";
    uiCtx.fillRect(c.x + 8, c.y + 8, w + padX * 2, 18 + padY);

    uiCtx.fillStyle = "#fff";
    uiCtx.fillText(text, c.x + 8 + padX, c.y + 8 + padY / 2);
  }
}
