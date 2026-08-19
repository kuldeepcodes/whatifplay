import Phaser from "phaser";
import "./style.css";
import { SillyAudio } from "./game/audio";
import { createChallenge, encodeChallenge, getChallengeFromLocation } from "./game/customRules";
import { GameScene } from "./game/GameScene";
import type { Accessory, CustomChallenge, PlayerStyle, RunConfig } from "./game/types";

const storageKeys = {
  style: "floor-is-style-v1",
  muted: "floor-is-muted-v1",
  challenges: "floor-is-challenges-v1",
} as const;

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Required element #${id} was not found.`);
  return found as T;
}

function readStyle(): PlayerStyle {
  const fallback: PlayerStyle = { color: "#ff4f9a", accessory: "crown" };
  const stored = localStorage.getItem(storageKeys.style);
  if (!stored) return fallback;
  try {
    const parsed = JSON.parse(stored) as Partial<PlayerStyle>;
    const color = typeof parsed.color === "string" && /^#[0-9a-f]{6}$/iu.test(parsed.color) ? parsed.color : fallback.color;
    const accessories: Accessory[] = ["crown", "party", "leaf", "none"];
    const accessory = accessories.includes(parsed.accessory as Accessory) ? parsed.accessory as Accessory : fallback.accessory;
    return { color, accessory };
  } catch (error) {
    console.warn("Ignoring invalid saved character style.", error);
    return fallback;
  }
}

const landing = element<HTMLElement>("landing");
const gameShell = element<HTMLElement>("game-shell");
const maker = element<HTMLElement>("rule-maker");
const pauseOverlay = element<HTMLElement>("pause-overlay");
const pauseTitle = element<HTMLElement>("pause-title");
const pauseDescription = pauseOverlay.querySelector<HTMLElement>("p:not(.eyebrow)") ?? (() => {
  throw new Error("Pause description is missing.");
})();
const playButton = element<HTMLButtonElement>("play-button");
const makeRuleButton = element<HTMLButtonElement>("make-rule-button");
const closeMakerButton = element<HTMLButtonElement>("close-rule-maker");
const playCustomButton = element<HTMLButtonElement>("play-custom");
const copyCustomButton = element<HTMLButtonElement>("copy-custom");
const customNameInput = element<HTMLInputElement>("custom-name");
const makerError = element<HTMLElement>("maker-error");
const playerColor = element<HTMLInputElement>("player-color");
const playerHat = element<HTMLSelectElement>("player-hat");
const soundButton = element<HTMLButtonElement>("sound-button");
const fullscreenButton = element<HTMLButtonElement>("fullscreen-button");
const pauseButton = element<HTMLButtonElement>("pause-button");
const resumeButton = element<HTMLButtonElement>("resume-button");
const restartButton = element<HTMLButtonElement>("restart-button");
const homeButton = element<HTMLButtonElement>("home-button");
const toast = element<HTMLElement>("toast");
const joystick = element<HTMLElement>("joystick");
const joystickKnob = element<HTMLElement>("joystick-knob");
const titleRule = element<HTMLElement>("title-rule");
const audio = new SillyAudio();

let game: Phaser.Game | null = null;
let currentConfig: RunConfig | null = null;
let paused = false;
let toastTimer = 0;
let activeChallenge: CustomChallenge | null = null;

const initialStyle = readStyle();
playerColor.value = initialStyle.color;
playerHat.value = initialStyle.accessory;
audio.setMuted(localStorage.getItem(storageKeys.muted) === "true");
updateSoundButton();

const titleRules = [" LAVA!", " WATER!", " GHOSTS!", " CHICKENS!", " FROGS!"];
let titleIndex = 0;
window.setInterval(() => {
  if (landing.classList.contains("hidden")) return;
  titleIndex = (titleIndex + 1) % titleRules.length;
  titleRule.textContent = titleRules[titleIndex] ?? " LAVA!";
}, 1800);

try {
  activeChallenge = getChallengeFromLocation(window.location.search);
  if (activeChallenge) {
    customNameInput.value = activeChallenge.name;
    for (const modifier of activeChallenge.modifiers) {
      const checkbox = document.querySelector<HTMLInputElement>(`input[name="modifier"][value="${modifier}"]`);
      if (checkbox) checkbox.checked = true;
    }
    showToast(`Challenge loaded: ${activeChallenge.name}`);
    playButton.textContent = "Play shared challenge ▶";
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "The shared challenge link is invalid.";
  console.warn(message);
  window.history.replaceState({}, "", window.location.pathname);
  window.setTimeout(() => showToast("That challenge link was malformed, so it was ignored."), 300);
}

playButton.addEventListener("click", () => startRun(activeChallenge));
makeRuleButton.addEventListener("click", openMaker);
closeMakerButton.addEventListener("click", closeMaker);
maker.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMaker();
});
playCustomButton.addEventListener("click", () => {
  const challenge = challengeFromForm();
  if (!challenge) return;
  saveChallenge(challenge);
  activeChallenge = challenge;
  closeMaker();
  startRun(challenge);
});
copyCustomButton.addEventListener("click", async () => {
  const challenge = challengeFromForm();
  if (!challenge) return;
  saveChallenge(challenge);
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("challenge", encodeChallenge(challenge));
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("Challenge link copied!");
  } catch (error) {
    console.error("Could not copy the challenge link.", error);
    makerError.textContent = "Your browser blocked clipboard access. Copy the URL from the address bar after playing.";
  }
});

playerColor.addEventListener("input", persistStyle);
playerHat.addEventListener("change", persistStyle);
soundButton.addEventListener("click", () => {
  audio.setMuted(!audio.isMuted());
  localStorage.setItem(storageKeys.muted, String(audio.isMuted()));
  updateSoundButton();
});
fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.error("Full-screen mode could not be changed.", error);
    showToast("Full screen is unavailable in this browser.");
  }
});

pauseButton.addEventListener("click", requestPause);
resumeButton.addEventListener("click", requestPause);
restartButton.addEventListener("click", restartRun);
homeButton.addEventListener("click", goHome);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && game && !paused) setPaused(true);
});

gameShell.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
  const action = button.dataset.action;
  if (action !== "jump" && action !== "grab" && action !== "emote") return;
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    game?.events.emit("touch-action", action);
  });
});

let joystickPointer: number | null = null;
joystick.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  joystickPointer = event.pointerId;
  joystick.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId === joystickPointer) updateJoystick(event);
});
joystick.addEventListener("pointerup", releaseJoystick);
joystick.addEventListener("pointercancel", releaseJoystick);

function currentStyle(): PlayerStyle {
  return { color: playerColor.value, accessory: playerHat.value as Accessory };
}

function persistStyle(): void {
  localStorage.setItem(storageKeys.style, JSON.stringify(currentStyle()));
}

async function startRun(challenge: CustomChallenge | null): Promise<void> {
  await audio.unlock();
  persistStyle();
  currentConfig = { style: currentStyle(), challenge };
  landing.classList.add("hidden");
  maker.classList.add("hidden");
  pauseOverlay.classList.add("hidden");
  gameShell.classList.remove("hidden");
  paused = false;

  if (!game) {
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-container",
      backgroundColor: "#49b8da",
      transparent: false,
      physics: {
        default: "arcade",
        arcade: { debug: false },
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: window.innerWidth,
        height: window.innerHeight,
      },
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scene: [GameScene],
      input: { touch: { capture: true } },
    });
    game.events.on("hud", updateHud);
    game.events.on("pause-changed", requestPause);
    game.events.on("run-ended", showRunEnd);
  }
  game.scene.stop("arena");
  game.scene.start("arena", { config: currentConfig, audio });
}

function restartRun(): void {
  if (!game || !currentConfig) return;
  setPaused(false);
  pauseOverlay.classList.add("hidden");
  game.scene.stop("arena");
  game.scene.start("arena", { config: currentConfig, audio });
}

function goHome(): void {
  setPaused(false);
  game?.scene.stop("arena");
  gameShell.classList.add("hidden");
  pauseOverlay.classList.add("hidden");
  landing.classList.remove("hidden");
  playButton.focus();
}

function requestPause(): void {
  if (!game || gameShell.classList.contains("hidden")) return;
  setPaused(!paused);
}

function setPaused(nextPaused: boolean): void {
  if (!game) return;
  paused = nextPaused;
  if (paused) {
    game.scene.pause("arena");
    pauseTitle.textContent = "Paused";
    pauseDescription.textContent = "Move with WASD or arrows. Space jumps, E grabs or throws, and Q makes an important noise.";
    resumeButton.classList.remove("hidden");
    restartButton.textContent = "Restart run";
    pauseOverlay.classList.remove("hidden");
    resumeButton.focus();
  } else {
    if (game.scene.isPaused("arena")) game.scene.resume("arena");
    pauseOverlay.classList.add("hidden");
  }
}

function showRunEnd(result: { score: number; survived: boolean }): void {
  paused = false;
  pauseTitle.textContent = result.survived ? "Island legend!" : "Spectacularly bonked";
  pauseDescription.textContent = `Final score: ${result.score.toLocaleString()}. ${result.survived ? "Five minutes of dignified chaos survived." : "The island would like to see that again."}`;
  resumeButton.classList.add("hidden");
  restartButton.textContent = "Play again";
  pauseOverlay.classList.remove("hidden");
  restartButton.focus();
}

function updateHud(payload: { score?: number; health?: number; rule?: string; timer?: number; kicker?: string }): void {
  if (payload.score !== undefined) element("score-value").textContent = String(payload.score);
  if (payload.health !== undefined) element("health-value").textContent = String(payload.health);
  if (payload.rule !== undefined) element("rule-name").textContent = payload.rule;
  if (payload.timer !== undefined) element("rule-timer").textContent = String(payload.timer);
  if (payload.kicker !== undefined) element("rule-kicker").textContent = payload.kicker;
}

function openMaker(): void {
  makerError.textContent = "";
  maker.classList.remove("hidden");
  customNameInput.focus();
}

function closeMaker(): void {
  maker.classList.add("hidden");
  makeRuleButton.focus();
}

function challengeFromForm(): CustomChallenge | null {
  makerError.textContent = "";
  const selected = [...document.querySelectorAll<HTMLInputElement>('input[name="modifier"]:checked')].map((input) => input.value);
  try {
    return createChallenge(customNameInput.value, selected, Date.now());
  } catch (error) {
    makerError.textContent = error instanceof Error ? error.message : "That challenge could not be created.";
    return null;
  }
}

function saveChallenge(challenge: CustomChallenge): void {
  let saved: CustomChallenge[] = [];
  const raw = localStorage.getItem(storageKeys.challenges);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) saved = parsed.slice(0, 9) as CustomChallenge[];
    } catch (error) {
      console.warn("Replacing invalid saved challenges.", error);
    }
  }
  const next = [challenge, ...saved.filter((item) => item.name !== challenge.name)].slice(0, 10);
  localStorage.setItem(storageKeys.challenges, JSON.stringify(next));
}

function updateSoundButton(): void {
  soundButton.textContent = audio.isMuted() ? "🔇 Muted" : "🔊 Sound";
  soundButton.setAttribute("aria-pressed", String(!audio.isMuted()));
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function updateJoystick(event: PointerEvent): void {
  const bounds = joystick.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  let x = event.clientX - centerX;
  let y = event.clientY - centerY;
  const max = bounds.width * 0.3;
  const distance = Math.hypot(x, y);
  if (distance > max) {
    x = x / distance * max;
    y = y / distance * max;
  }
  joystickKnob.style.transform = `translate(${x}px, ${y}px)`;
  game?.events.emit("touch-move", { x: x / max, y: y / max });
}

function releaseJoystick(event: PointerEvent): void {
  if (event.pointerId !== joystickPointer) return;
  joystickPointer = null;
  joystickKnob.style.transform = "";
  game?.events.emit("touch-move", { x: 0, y: 0 });
}

window.addEventListener("keydown", (event) => {
  if (gameShell.classList.contains("hidden")) return;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
}, { passive: false });
