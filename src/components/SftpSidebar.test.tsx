import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import SftpSidebar from "./SftpSidebar";
import { Provider } from "./ui/provider"; // Adjust based on your Chakra setup
import { useSftpStore } from "../store/useSftpStore";
import { useSessionStore } from "../store/useSessionStore";

// Mock the store
vi.mock("../store/useSftpStore", () => ({
  useSftpStore: vi.fn(),
}));

vi.mock("../store/useSessionStore", () => ({
  useSessionStore: vi.fn(),
}));

describe("SftpSidebar", () => {
    it("should render the placeholder when no files are present", () => {
        (useSessionStore as any).mockReturnValue("session-1");
        (useSftpStore as any).mockReturnValue({
            currentPath: "/",
            files: [],
            isLoading: false,
            error: null,
            fetchDirectory: vi.fn(),
            cd: vi.fn(),
        });

        render(
            <Provider>
                <SftpSidebar />
            </Provider>
        );

        expect(screen.getByText("SFTP EXPLORER")).toBeInTheDocument();
        expect(screen.getByText("Root")).toBeInTheDocument();
    });

    it("should render file names when files are present", () => {
        (useSftpStore as any).mockReturnValue({
            currentPath: "/home",
            files: [
                { name: "test.txt", is_dir: false, is_file: true, size: 1024, modified: 0 },
                { name: "folder1", is_dir: true, is_file: false, size: 0, modified: 0 },
            ],
            isLoading: false,
            error: null,
            fetchDirectory: vi.fn(),
            cd: vi.fn(),
        });

        render(
            <Provider>
                <SftpSidebar />
            </Provider>
        );

        expect(screen.getByText("test.txt")).toBeInTheDocument();
        expect(screen.getByText("folder1")).toBeInTheDocument();
        expect(screen.getByText("home")).toBeInTheDocument();
    });
});
