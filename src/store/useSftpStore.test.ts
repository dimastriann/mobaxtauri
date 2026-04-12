import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSftpStore } from "./useSftpStore";

// Mock Tauri's invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe("useSftpStore", () => {
  beforeEach(() => {
    useSftpStore.getState().reset();
  });

  it("should initialize with root path", () => {
    const state = useSftpStore.getState();
    expect(state.currentPath).toBe("/");
  });

  it("should update currentPath when cd is called", async () => {
    const { cd } = useSftpStore.getState();
    
    // We need to mock the search_dir invoke that fetchDirectory calls
    // But for a simple unit test of 'cd' logic:
    await cd("session-1", "/etc/docker");
    
    const state = useSftpStore.getState();
    expect(state.currentPath).toBe("/etc/docker");
  });

  it("should handle relative navigation with '..'", async () => {
     const { cd } = useSftpStore.getState();
     
     await cd("session-1", "/etc/docker");
     await cd("session-1", "..");
     
     const state = useSftpStore.getState();
     expect(state.currentPath).toBe("/etc");
  });

  it("should not go above root with '..'", async () => {
    const { cd } = useSftpStore.getState();
    
    await cd("session-1", "/");
    await cd("session-1", "..");
    
    const state = useSftpStore.getState();
    expect(state.currentPath).toBe("/");
 });

 it("should sort directories first and then alphabetically", async () => {
    const { fetchDirectory } = useSftpStore.getState();
    const { invoke } = await import('@tauri-apps/api/core');
    
    // Mock files in mixed order
    const mockFiles = [
        { name: 'zebra.txt', is_dir: false, is_file: true, size: 100, modified: 0 },
        { name: 'apple.txt', is_dir: false, is_file: true, size: 200, modified: 0 },
        { name: 'docs', is_dir: true, is_file: false, size: 0, modified: 0 },
        { name: 'apps', is_dir: true, is_file: false, size: 0, modified: 0 },
    ];

    vi.mocked(invoke).mockResolvedValueOnce(mockFiles);

    await fetchDirectory("session-1", "/home");

    const state = useSftpStore.getState();
    expect(state.files[0].name).toBe("apps"); // Dir 1
    expect(state.files[1].name).toBe("docs"); // Dir 2
    expect(state.files[2].name).toBe("apple.txt"); // File 1
    expect(state.files[3].name).toBe("zebra.txt"); // File 2
 });

 it("should set error state when fetch fails", async () => {
    const { fetchDirectory } = useSftpStore.getState();
    const { invoke } = await import('@tauri-apps/api/core');
    
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Connection lost"));

    await fetchDirectory("session-1", "/home");

    const state = useSftpStore.getState();
    expect(state.error).toContain("Connection lost");
    expect(state.isLoading).toBe(false);
 });
});
