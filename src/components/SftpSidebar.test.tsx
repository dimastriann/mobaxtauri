import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, type Mock } from 'vitest';
import SftpSidebar from './SftpSidebar';
import { Provider } from './ui/provider'; // Adjust based on your Chakra setup
import { useSftpStore } from '../store/useSftpStore';
import { useSessionStore } from '../store/useSessionStore';

// Mock the store
vi.mock('../store/useSftpStore', () => ({
  useSftpStore: vi.fn(),
}));

vi.mock('../store/useSessionStore', () => ({
  useSessionStore: vi.fn(),
}));

const mockedUseSessionStore = useSessionStore as unknown as Mock;
const mockedUseSftpStore = useSftpStore as unknown as Mock;

describe('SftpSidebar', () => {
  it('should render the placeholder when no files are present', () => {
    mockedUseSessionStore.mockReturnValue('session-1');
    mockedUseSftpStore.mockReturnValue({
      currentPath: '/',
      files: [],
      isLoading: false,
      error: null,
      transfers: [],
      fetchDirectory: vi.fn(),
      cd: vi.fn(),
    });

    render(
      <Provider>
        <SftpSidebar />
      </Provider>,
    );

    expect(screen.getByText('SFTP EXPLORER')).toBeInTheDocument();
    expect(screen.getByText('Root')).toBeInTheDocument();
  });

  it('supports ctrl-click and shift-click multi selection', () => {
    mockedUseSessionStore.mockReturnValue('session-1');
    mockedUseSftpStore.mockReturnValue({
      currentPath: '/home',
      files: [
        { name: 'a.txt', is_dir: false, is_file: true, size: 1, modified: 0, mode: 0o100644 },
        { name: 'b.txt', is_dir: false, is_file: true, size: 1, modified: 0, mode: 0o100644 },
        { name: 'c.txt', is_dir: false, is_file: true, size: 1, modified: 0, mode: 0o100644 },
      ],
      isLoading: false,
      error: null,
      transfers: [],
      fetchDirectory: vi.fn(),
      cd: vi.fn(),
    });

    render(
      <Provider>
        <SftpSidebar />
      </Provider>,
    );

    const a = screen.getByRole('option', { name: 'a.txt' });
    const b = screen.getByRole('option', { name: 'b.txt' });
    const c = screen.getByRole('option', { name: 'c.txt' });

    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(b, { ctrlKey: true });
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(b).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(c, { shiftKey: true });
    expect(a).toHaveAttribute('aria-selected', 'false');
    expect(b).toHaveAttribute('aria-selected', 'true');
    expect(c).toHaveAttribute('aria-selected', 'true');
  });

  it('clears the selection when the list background is clicked', () => {
    mockedUseSessionStore.mockReturnValue('session-1');
    mockedUseSftpStore.mockReturnValue({
      currentPath: '/home',
      files: [
        { name: 'a.txt', is_dir: false, is_file: true, size: 1, modified: 0, mode: 0o100644 },
      ],
      isLoading: false,
      error: null,
      transfers: [],
      fetchDirectory: vi.fn(),
      cd: vi.fn(),
    });

    render(
      <Provider>
        <SftpSidebar />
      </Provider>,
    );

    const a = screen.getByRole('option', { name: 'a.txt' });
    fireEvent.click(a);
    expect(a).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('listbox', { name: 'SFTP files' }));
    expect(a).toHaveAttribute('aria-selected', 'false');
  });

  it('should render file names when files are present', () => {
    mockedUseSftpStore.mockReturnValue({
      currentPath: '/home',
      files: [
        { name: 'test.txt', is_dir: false, is_file: true, size: 1024, modified: 0 },
        { name: 'folder1', is_dir: true, is_file: false, size: 0, modified: 0 },
      ],
      isLoading: false,
      error: null,
      transfers: [],
      fetchDirectory: vi.fn(),
      cd: vi.fn(),
    });

    render(
      <Provider>
        <SftpSidebar />
      </Provider>,
    );

    expect(screen.getByText('test.txt')).toBeInTheDocument();
    expect(screen.getByText('folder1')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
  });
});
