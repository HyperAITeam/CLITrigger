import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screenToClient, startViewportTracking } from './popoutBus';

type W = Window & { electronAPI?: { getZoomFactor?: () => number } };

function setWindowOrigin(x: number, y: number) {
  Object.defineProperty(window, 'screenX', { value: x, configurable: true, writable: true });
  Object.defineProperty(window, 'screenY', { value: y, configurable: true, writable: true });
}

function mouseAt(screenX: number, screenY: number, clientX: number, clientY: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { screenX, screenY, clientX, clientY }));
}

describe('screenToClient', () => {
  let stop: () => void;
  beforeEach(() => {
    setWindowOrigin(1000, 500);
    delete (window as W).electronAPI;
    stop = startViewportTracking();
  });
  afterEach(() => stop());

  it('anchors on the last mouse sample', () => {
    mouseAt(1500, 900, 100, 60);
    expect(screenToClient(1600, 950)).toEqual({ x: 200, y: 110 });
  });

  it('follows the window when it moves after the sample (app-region drag)', () => {
    mouseAt(1500, 900, 100, 60);
    setWindowOrigin(1300, 550); // moved +300, +50 with no mousemove
    expect(screenToClient(1600, 950)).toEqual({ x: -100, y: 60 });
  });

  it('divides screen deltas by the page zoom', () => {
    (window as W).electronAPI = { getZoomFactor: () => 1.25 };
    mouseAt(1500, 900, 80, 48); // client origin = (1500 − 100, 900 − 60)
    expect(screenToClient(1600, 950)).toEqual({ x: 160, y: 88 });
  });
});
