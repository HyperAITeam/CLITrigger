import { describe, it, expect } from 'vitest';
import { detectViewportZone, viewportZoneToGeom, dockEdgeGeom } from '../../components/group/DockOverlay';

// Geometry mirrors DockOverlay's ARM_SIZE=28 / ARM_OFFSET=68 cross, centered
// on the viewport, plus the pop-out box at -(ARM_OFFSET*2+12) above center.
const VP_W = 1200;
const VP_H = 800;
const CX = VP_W / 2;
const CY = VP_H / 2;

describe('detectViewportZone', () => {
  it('hits the five cross boxes and the pop-out box', () => {
    expect(detectViewportZone(CX, CY, VP_W, VP_H)).toBe('max');
    expect(detectViewportZone(CX - 68, CY, VP_W, VP_H)).toBe('left');
    expect(detectViewportZone(CX + 68, CY, VP_W, VP_H)).toBe('right');
    expect(detectViewportZone(CX, CY - 68, VP_W, VP_H)).toBe('top');
    expect(detectViewportZone(CX, CY + 68, VP_W, VP_H)).toBe('bottom');
    expect(detectViewportZone(CX, CY - 148, VP_W, VP_H)).toBe('popout');
  });

  it('returns null outside every box', () => {
    expect(detectViewportZone(CX + 68 + 29, CY, VP_W, VP_H)).toBeNull();
    expect(detectViewportZone(CX + 50, CY + 50, VP_W, VP_H)).toBeNull();
    expect(detectViewportZone(CX, CY - 148 - 29, VP_W, VP_H)).toBeNull();
    expect(detectViewportZone(0, 0, VP_W, VP_H)).toBeNull();
  });

  it('box edges are inclusive', () => {
    expect(detectViewportZone(CX + 28, CY + 28, VP_W, VP_H)).toBe('max');
    expect(detectViewportZone(CX - 68 - 28, CY, VP_W, VP_H)).toBe('left');
    expect(detectViewportZone(CX + 28, CY - 148 + 28, VP_W, VP_H)).toBe('popout');
  });
});

describe('viewportZoneToGeom', () => {
  it('maps edge zones to half the content area (right of contentLeft)', () => {
    expect(viewportZoneToGeom('left', VP_W, VP_H, 240)).toEqual({ x: 240, y: 0, w: 480, h: VP_H });
    expect(viewportZoneToGeom('right', VP_W, VP_H, 240)).toEqual({ x: 720, y: 0, w: 480, h: VP_H });
    expect(viewportZoneToGeom('top', VP_W, VP_H, 240)).toEqual({ x: 240, y: 0, w: 960, h: 400 });
    expect(viewportZoneToGeom('bottom', VP_W, VP_H, 240)).toEqual({ x: 240, y: 400, w: 960, h: 400 });
  });

  it('max fills the content area to the right of contentLeft', () => {
    expect(viewportZoneToGeom('max', VP_W, VP_H, 240)).toEqual({ x: 240, y: 0, w: 960, h: VP_H });
    expect(viewportZoneToGeom('max', VP_W, VP_H, 0)).toEqual({ x: 0, y: 0, w: VP_W, h: VP_H });
  });
});

describe('dockEdgeGeom', () => {
  it('anchors the group to the edge with the given primary size', () => {
    expect(dockEdgeGeom('left', 300, VP_W, VP_H, 240)).toEqual({ x: 240, y: 0, w: 300, h: VP_H });
    expect(dockEdgeGeom('right', 300, VP_W, VP_H, 240)).toEqual({ x: 900, y: 0, w: 300, h: VP_H });
    expect(dockEdgeGeom('top', 250, VP_W, VP_H, 240)).toEqual({ x: 240, y: 0, w: 960, h: 250 });
    expect(dockEdgeGeom('bottom', 250, VP_W, VP_H, 240)).toEqual({ x: 240, y: 550, w: 960, h: 250 });
  });
});
