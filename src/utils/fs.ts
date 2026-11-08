import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, readdirSync, rmSync, readlinkSync } from 'node:fs';
import { dirname } from 'node:path';

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export function symlinkTarget(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

export function isEmptyDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory() && readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

export function dirExists(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function createSymlink(target: string, linkPath: string): void {
  ensureDir(dirname(linkPath));
  symlinkSync(target, linkPath, 'dir');
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function removePath(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    rmSync(path, { recursive: true, force: true });
  }
}

export { existsSync, readdirSync };
