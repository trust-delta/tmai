// The File System Access API directory async-iteration is not in this TS
// version's lib.dom. Declaration-merge the one method the offline aim mode uses
// (`api-files.ts`) onto the existing `FileSystemDirectoryHandle` — additive, so
// it composes with the lib.dom definition rather than conflicting.

declare global {
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}

export {};
