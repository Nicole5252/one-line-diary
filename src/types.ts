export interface Entry {
  id: string;
  day: string;
  createdAt: number;
  order: number;
  raw: string;
  /** null = not yet shortened (display raw) */
  short: string | null;
  images: Blob[];
}
export interface DiaryCache {
  day: string;
  hash: string;
  text: string;
}
