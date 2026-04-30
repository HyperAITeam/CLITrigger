import { get, post, put, del } from './client';
import type { Favorite, FavoriteType } from '../types';

export interface FavoriteInput {
  name: string;
  type: FavoriteType;
  target: string;
  args?: string[] | null;
  cwd?: string | null;
  icon?: string | null;
}

export function listFavorites(): Promise<Favorite[]> {
  return get('/api/favorites');
}

export function createFavorite(data: FavoriteInput): Promise<Favorite> {
  return post('/api/favorites', data);
}

export function updateFavorite(id: string, data: FavoriteInput): Promise<Favorite> {
  return put(`/api/favorites/${id}`, data);
}

export function deleteFavorite(id: string): Promise<void> {
  return del(`/api/favorites/${id}`);
}

export function launchFavorite(id: string): Promise<{ ok: true }> {
  return post(`/api/favorites/${id}/launch`);
}
