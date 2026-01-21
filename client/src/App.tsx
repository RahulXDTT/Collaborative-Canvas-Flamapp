// client/src/App.tsx

import React, { useEffect, useMemo, useState } from "react";
import { realtime } from "./net/socket";
import { roomStore } from "./state/roomStore";
import CanvasStage from "./canvas/CanvasStage";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:8081";

type Theme = "light" | "dark";
const THEME_KEY = "collab_theme";

function useRoom() {
  const [, setTick] = useState(0);
  useEffect(() => roomStore.subscribe(() => setTick((t) => t + 1)), []);
  return roomStore.getState();
}

function getOrCreateClientId(): string {
  const key = "collab_client_id";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}

function getInitialTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  const prefersDark =
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="M12 2v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 20v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.93 4.93l1.41 1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M17.66 17.66l1.41 1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 12h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.93 19.07l1.41-1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 13.2A7.2 7.2 0 0 1 10.8 3a8.8 8.8 0 1 0 10.2 10.2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BrushIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g transform="translate(12, 12) rotate(-45) translate(-12, -12)">
        <rect x="10" y="2" width="4" height="6" rx="1" fill="currentColor" />
        <path
          d="M8 8h8M8 10h8M8 12h8M8 14h8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M9 8v8h6V8"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="8" y="16" width="8" height="3" rx="0.5" fill="currentColor" />
      </g>
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"
        fill="currentColor"
      />
      <path
        d="M7 20h10M6 20h12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RectangleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="6" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export default function App() {
  const room = useRoom();

  const [roomId, setRoomId] = useState("demo");
  const [name, setName] = useState("Rahul");
  const [mode, setMode] = useState<"edit" | "view">("edit");

  const [tool, setTool] = useState<"brush" | "eraser" | "rectangle" | "circle" | "square">("brush");
  const [color, setColor] = useState("#22c55e");
  const [w, setW] = useState(4);

  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());

  const users = useMemo(() => Array.from(room.users.values()), [room.users]);

  useEffect(() => {
    realtime.connect(SERVER_URL);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  async function handleJoin() {
    try {
      const ack = await realtime.join({
        roomId: roomId.trim() || "demo",
        name: name.trim() || "User",
        mode,
        clientId: getOrCreateClientId()
      });

      const el = document.getElementById("statusText");
      if (el) el.textContent = ack.ok ? `Joined: ${ack.roomId}` : `Join failed`;
    } catch (err) {
      const el = document.getElementById("statusText");
      if (el) el.textContent = "Join failed: Connection error";
      console.error("Join error:", err);
    }
  }

  function undo() {
    realtime.sendOp({ t: "undo" });
  }

  function redo() {
    realtime.sendOp({ t: "redo" });
  }

  const connectedLabel = room.connected ? "Online" : "Offline";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/collaborative-icon.jpg" alt="Collaborative Canvas" className="brandIcon" />
          Collaborative Canvas
        </div>

        <div className="topbarRight">
          <div className="statusPill" aria-live="polite">
            <span className={`statusDot ${room.connected ? "statusDotOnline" : ""}`} />
            <span>{connectedLabel}</span>
            <span id="statusText" className="statusTextMargin">
              {room.roomId ? `Room: ${room.roomId}` : ""}
            </span>
          </div>

          <button
            className="btn btnGhost btnIcon"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            aria-label="Toggle theme"
            title="Toggle theme"
            type="button"
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <main className="main">
        <aside className="sidebar">
          <div className="panel">
            <div className="panelTitle">Join Room</div>
            <div className="panelBody">
              <div className="inputRow">
                <input
                  className="input"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  placeholder="room id"
                  aria-label="Room ID"
                />
                <button className="btn btnPrimary" onClick={handleJoin} type="button">
                  Join
                </button>
              </div>

              <div className="inputRow">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="name"
                  aria-label="Name"
                />
                <select
                  className="select"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "edit" | "view")}
                  aria-label="Mode"
                >
                  <option value="edit">edit</option>
                  <option value="view">view</option>
                </select>
              </div>

              <div className="buttonRow">
                <button
                  className="btn"
                  onClick={undo}
                  disabled={!room.roomId || !room.connected || mode === "view"}
                  type="button"
                >
                  Undo (Global)
                </button>
                <button
                  className="btn"
                  onClick={redo}
                  disabled={!room.roomId || !room.connected || mode === "view"}
                  type="button"
                >
                  Redo (Global)
                </button>
              </div>

              <div className="hint hintMarginTop">
                Tip: Hold <b>Space</b> and drag to pan. Use the mouse wheel to zoom.
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">Tools</div>
            <div className="panelBody">
              <div className="segmented" role="tablist" aria-label="Tools">
                {/* eslint-disable-next-line jsx-a11y/aria-props */}
                <button
                  className={`segBtn ${tool === "brush" ? "segBtnActive" : ""}`}
                  onClick={() => setTool("brush" as const)}
                  type="button"
                  role="tab"
                  aria-selected={tool === "brush"}
                  title="Brush Tool"
                >
                  <BrushIcon />
                </button>
                {/* eslint-disable-next-line jsx-a11y/aria-props */}
                <button
                  className={`segBtn ${tool === "eraser" ? "segBtnActive" : ""}`}
                  onClick={() => setTool("eraser" as const)}
                  type="button"
                  role="tab"
                  aria-selected={tool === "eraser"}
                  title="Eraser Tool"
                >
                  <EraserIcon />
                </button>
                {/* eslint-disable-next-line jsx-a11y/aria-props */}
                <button
                  className={`segBtn ${tool === "rectangle" ? "segBtnActive" : ""}`}
                  onClick={() => setTool("rectangle" as const)}
                  type="button"
                  role="tab"
                  aria-selected={tool === "rectangle"}
                  title="Rectangle Tool"
                >
                  <RectangleIcon />
                </button>
                {/* eslint-disable-next-line jsx-a11y/aria-props */}
                <button
                  className={`segBtn ${tool === "circle" ? "segBtnActive" : ""}`}
                  onClick={() => setTool("circle" as const)}
                  type="button"
                  role="tab"
                  aria-selected={tool === "circle"}
                  title="Circle Tool"
                >
                  <CircleIcon />
                </button>
                {/* eslint-disable-next-line jsx-a11y/aria-props */}
                <button
                  className={`segBtn ${tool === "square" ? "segBtnActive" : ""}`}
                  onClick={() => setTool("square" as const)}
                  type="button"
                  role="tab"
                  aria-selected={tool === "square"}
                  title="Square Tool"
                >
                  <SquareIcon />
                </button>
              </div>

              <div className="row rowMarginTop">
                <input
                  className="colorInput"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Brush color"
                />
                <input
                  className="range"
                  type="range"
                  min={1}
                  max={24}
                  value={w}
                  onChange={(e) => setW(parseInt(e.target.value, 10))}
                  aria-label="Brush width"
                />
                <span className="badge">{w}px</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panelTitle">Users Online</div>
            <div className="panelBody">
              {users.length === 0 ? (
                <div className="userMode">Join a room to see users</div>
              ) : (
                <ul className="usersList">
                  {users.map((u) => (
                    <li key={u.userId} className="userItem">
                      {/* eslint-disable-next-line */}
                      <span className="userColor" style={{ backgroundColor: u.color }} />
                      <span>{u.name}</span>
                      <span className="userMode">({u.mode})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>

        <section className="stage">
          <CanvasStage tool={tool} color={color} width={w} />
        </section>
      </main>
    </div>
  );
}
