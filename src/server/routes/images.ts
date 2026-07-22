import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getTodoById, updateTodo, getPlannerItemById, updatePlannerItem, getTodosByProjectId, getPlannerItemsByProjectId, getPlannerPageById, getPlannerPagesByProjectId, getPersonalItemById, updatePersonalItem } from '../db/queries.js';

const router = Router();

/** Directory where uploaded images are stored */
function getUploadsDir(): string {
  const dir = path.resolve(process.cwd(), 'data', 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getTodoImageDir(todoId: string): string {
  const dir = path.join(getUploadsDir(), todoId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export interface ImageMeta {
  id: string;
  filename: string;
  originalName: string;
  size: number;
}

// POST /api/todos/:id/images - Upload images (base64 JSON body)
router.post('/todos/:id/images', (req: Request<{ id: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const { images } = req.body as { images: Array<{ name: string; data: string }> };
    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'images array is required' });
      return;
    }

    const todoDir = getTodoImageDir(todo.id);
    const existingImages: ImageMeta[] = todo.images ? JSON.parse(todo.images) : [];

    const newImages: ImageMeta[] = [];
    for (const img of images) {
      // Validate base64 data URL format
      const match = img.data.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
      if (!match) continue;

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'svg+xml' ? 'svg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');

      // Limit individual image size to 10MB
      if (buffer.length > 10 * 1024 * 1024) continue;

      const id = uuidv4();
      const filename = `${id}.${ext}`;
      const filePath = path.join(todoDir, filename);

      fs.writeFileSync(filePath, buffer);

      const meta: ImageMeta = {
        id,
        filename,
        originalName: img.name || filename,
        size: buffer.length,
      };
      newImages.push(meta);
    }

    const allImages = [...existingImages, ...newImages];
    updateTodo(todo.id, { images: JSON.stringify(allImages) });

    res.status(201).json({ images: allImages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/todos/:id/images/:imageId - Delete a single image
router.delete('/todos/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const existingImages: ImageMeta[] = todo.images ? JSON.parse(todo.images) : [];
    const imageToDelete = existingImages.find(img => img.id === req.params.imageId);
    if (!imageToDelete) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Delete file from disk
    const filePath = path.join(getUploadsDir(), todo.id, imageToDelete.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const remainingImages = existingImages.filter(img => img.id !== req.params.imageId);
    updateTodo(todo.id, { images: remainingImages.length > 0 ? JSON.stringify(remainingImages) : null });

    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/todos/:id/images/:imageId - Serve an image file
router.get('/todos/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const todo = getTodoById(req.params.id);
    if (!todo) {
      res.status(404).json({ error: 'Todo not found' });
      return;
    }

    const existingImages: ImageMeta[] = todo.images ? JSON.parse(todo.images) : [];
    const image = existingImages.find(img => img.id === req.params.imageId);
    if (!image) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const filePath = path.join(getUploadsDir(), todo.id, image.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image file not found' });
      return;
    }

    const ext = path.extname(image.filename).toLowerCase().slice(1);
    const mimeTypes: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    // SVG can carry scripts; sandbox it so opening the URL directly can't run JS.
    if (ext === 'svg') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

function getPlannerImageDir(plannerItemId: string): string {
  const dir = path.join(getUploadsDir(), 'planner', plannerItemId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// POST /api/planner/:id/images - Upload images for planner item
router.post('/planner/:id/images', (req: Request<{ id: string }>, res: Response) => {
  try {
    const item = getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }

    const { images } = req.body as { images: Array<{ name: string; data: string }> };
    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'images array is required' });
      return;
    }

    const itemDir = getPlannerImageDir(item.id);
    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];

    const newImages: ImageMeta[] = [];
    for (const img of images) {
      const match = img.data.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
      if (!match) continue;

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'svg+xml' ? 'svg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 10 * 1024 * 1024) continue;

      const id = uuidv4();
      const filename = `${id}.${ext}`;
      fs.writeFileSync(path.join(itemDir, filename), buffer);

      newImages.push({ id, filename, originalName: img.name || filename, size: buffer.length });
    }

    const allImages = [...existingImages, ...newImages];
    updatePlannerItem(item.id, { images: JSON.stringify(allImages) });

    res.status(201).json({ images: allImages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/planner/:id/images/:imageId
router.delete('/planner/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const item = getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }

    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];
    const imageToDelete = existingImages.find(img => img.id === req.params.imageId);
    if (!imageToDelete) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const filePath = path.join(getUploadsDir(), 'planner', item.id, imageToDelete.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const remainingImages = existingImages.filter(img => img.id !== req.params.imageId);
    updatePlannerItem(item.id, { images: remainingImages.length > 0 ? JSON.stringify(remainingImages) : null });

    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/planner/:id/images/:imageId
router.get('/planner/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const item = getPlannerItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Planner item not found' });
      return;
    }

    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];
    const image = existingImages.find(img => img.id === req.params.imageId);
    if (!image) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const filePath = path.join(getUploadsDir(), 'planner', item.id, image.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image file not found' });
      return;
    }

    const ext = path.extname(image.filename).toLowerCase().slice(1);
    const mimeTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    // SVG can carry scripts; sandbox it so opening the URL directly can't run JS.
    if (ext === 'svg') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

function getPlannerPageFileDir(pageId: string): string {
  const dir = path.join(getUploadsDir(), 'planner-pages', pageId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Mime types accepted for planner page files (BlockNote image/video blocks). */
const PAGE_FILE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv',
};

// POST /api/planner/pages/:pageId/files - Upload a single image/video for a page
// (called by BlockNote's uploadFile, one file per request). No DB tracking —
// the returned URL lives inside the page's BlockNote content JSON.
router.post('/planner/pages/:pageId/files', (req: Request<{ pageId: string }>, res: Response) => {
  try {
    const page = getPlannerPageById(req.params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Planner page not found' });
      return;
    }

    const { data } = req.body as { name?: string; data?: string };
    const match = typeof data === 'string' ? data.match(/^data:((?:image|video)\/[a-z0-9+.-]+);base64,(.+)$/) : null;
    const ext = match ? PAGE_FILE_EXTENSIONS[match[1]] : undefined;
    if (!match || !ext) {
      res.status(400).json({ error: 'Unsupported file type' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    // ponytail: 30MB video cap so the base64 body stays under the 50mb
    // express.json limit; move to a streaming upload if larger videos matter.
    const maxSize = match[1].startsWith('video/') ? 30 * 1024 * 1024 : 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      res.status(413).json({ error: 'File too large' });
      return;
    }

    const filename = `${uuidv4()}.${ext}`;
    fs.writeFileSync(path.join(getPlannerPageFileDir(page.id), filename), buffer);

    res.status(201).json({ url: `/api/planner/pages/${page.id}/files/${filename}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/planner/pages/:pageId/files/:filename - Serve a page file
router.get('/planner/pages/:pageId/files/:filename', (req: Request<{ pageId: string; filename: string }>, res: Response) => {
  try {
    const page = getPlannerPageById(req.params.pageId);
    if (!page) {
      res.status(404).json({ error: 'Planner page not found' });
      return;
    }

    // Filenames are server-generated (uuid.ext); reject anything else (path traversal guard).
    if (!/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(req.params.filename)) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(getUploadsDir(), 'planner-pages', page.id, req.params.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    const ext = path.extname(req.params.filename).toLowerCase().slice(1);
    const mimeTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    // SVG can carry scripts; sandbox it so opening the URL directly can't run JS.
    if (ext === 'svg') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

function getPersonalImageDir(personalItemId: string): string {
  const dir = path.join(getUploadsDir(), 'personal', personalItemId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// POST /api/personal-items/:id/images - Upload images for personal item
router.post('/personal-items/:id/images', (req: Request<{ id: string }>, res: Response) => {
  try {
    const item = getPersonalItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Personal item not found' });
      return;
    }

    const { images } = req.body as { images: Array<{ name: string; data: string }> };
    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'images array is required' });
      return;
    }

    const itemDir = getPersonalImageDir(item.id);
    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];

    const newImages: ImageMeta[] = [];
    for (const img of images) {
      const match = img.data.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
      if (!match) continue;

      const ext = match[1] === 'jpeg' ? 'jpg' : match[1] === 'svg+xml' ? 'svg' : match[1];
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 10 * 1024 * 1024) continue;

      const id = uuidv4();
      const filename = `${id}.${ext}`;
      fs.writeFileSync(path.join(itemDir, filename), buffer);

      newImages.push({ id, filename, originalName: img.name || filename, size: buffer.length });
    }

    const allImages = [...existingImages, ...newImages];
    updatePersonalItem(item.id, { images: JSON.stringify(allImages) });

    res.status(201).json({ images: allImages });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// DELETE /api/personal-items/:id/images/:imageId
router.delete('/personal-items/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const item = getPersonalItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Personal item not found' });
      return;
    }

    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];
    const imageToDelete = existingImages.find(img => img.id === req.params.imageId);
    if (!imageToDelete) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const filePath = path.join(getUploadsDir(), 'personal', item.id, imageToDelete.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    const remainingImages = existingImages.filter(img => img.id !== req.params.imageId);
    updatePersonalItem(item.id, { images: remainingImages.length > 0 ? JSON.stringify(remainingImages) : null });

    res.status(204).send();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /api/personal-items/:id/images/:imageId
router.get('/personal-items/:id/images/:imageId', (req: Request<{ id: string; imageId: string }>, res: Response) => {
  try {
    const item = getPersonalItemById(req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Personal item not found' });
      return;
    }

    const existingImages: ImageMeta[] = item.images ? JSON.parse(item.images) : [];
    const image = existingImages.find(img => img.id === req.params.imageId);
    if (!image) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const filePath = path.join(getUploadsDir(), 'personal', item.id, image.filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Image file not found' });
      return;
    }

    const ext = path.extname(image.filename).toLowerCase().slice(1);
    const mimeTypes: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    };
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    // SVG can carry scripts; sandbox it so opening the URL directly can't run JS.
    if (ext === 'svg') res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * Get the on-disk paths for all images of a todo.
 * Used by orchestrator to copy images to worktree.
 */
export function getTodoImagePaths(todoId: string): Array<{ filename: string; filePath: string }> {
  const todo = getTodoById(todoId);
  if (!todo || !todo.images) return [];

  const images: ImageMeta[] = JSON.parse(todo.images);
  const uploadsDir = getUploadsDir();

  return images
    .map(img => ({
      filename: img.filename,
      filePath: path.join(uploadsDir, todoId, img.filename),
    }))
    .filter(({ filePath }) => fs.existsSync(filePath));
}

/**
 * Get the on-disk paths for all images of a planner item.
 * Used when converting planner items to todos.
 */
export function getPlannerImagePaths(plannerItemId: string): Array<{ filename: string; filePath: string }> {
  const item = getPlannerItemById(plannerItemId);
  if (!item || !item.images) return [];

  const images: ImageMeta[] = JSON.parse(item.images);
  const uploadsDir = getUploadsDir();

  return images
    .map(img => ({
      filename: img.filename,
      filePath: path.join(uploadsDir, 'planner', plannerItemId, img.filename),
    }))
    .filter(({ filePath }) => fs.existsSync(filePath));
}

/**
 * Delete all image files for a single todo from disk.
 */
export function cleanupTodoImages(todoId: string): void {
  const dir = path.join(getUploadsDir(), todoId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Delete all image files for a single planner item from disk.
 */
export function cleanupPlannerImages(plannerItemId: string): void {
  const dir = path.join(getUploadsDir(), 'planner', plannerItemId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Delete all uploaded files for a single planner page from disk.
 */
export function cleanupPlannerPageFiles(pageId: string): void {
  const dir = path.join(getUploadsDir(), 'planner-pages', pageId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Delete all image files for a single personal item from disk.
 */
export function cleanupPersonalImages(personalItemId: string): void {
  const dir = path.join(getUploadsDir(), 'personal', personalItemId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Delete all image files for a project (all todos + all planner items) from disk.
 * Call BEFORE the DB cascade delete so we can still query item IDs.
 */
export function cleanupProjectImages(projectId: string): void {
  const uploadsDir = getUploadsDir();
  const todos = getTodosByProjectId(projectId);
  for (const todo of todos) {
    if (todo.images) {
      const dir = path.join(uploadsDir, todo.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const items = getPlannerItemsByProjectId(projectId);
  for (const item of items) {
    if (item.images) {
      const dir = path.join(uploadsDir, 'planner', item.id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  const pages = getPlannerPagesByProjectId(projectId);
  for (const page of pages) {
    const dir = path.join(uploadsDir, 'planner-pages', page.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export default router;
