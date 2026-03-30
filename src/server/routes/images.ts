import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getTodoById, updateTodo } from '../db/queries.js';

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

export default router;
