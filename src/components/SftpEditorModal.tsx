import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, HStack, Button, Text, Spinner, Textarea, Badge } from '@chakra-ui/react';
import { invoke } from '@tauri-apps/api/core';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';

interface SftpEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  filePath: string;
  fileName: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  rs: 'Rust',
  py: 'Python',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  md: 'Markdown',
  sql: 'SQL',
};

const KEYWORDS = new Set(
  `as async await break case catch class const continue crate def do else enum export extends false
  fn for from function if impl import in interface let loop match mod move mut new none null pub raise
  ref return self static struct super switch this throw trait true try type typeof undefined use var where
  while yield`.split(/\s+/),
);

const TOKEN_PATTERN =
  /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;

const highlightLine = (line: string, lineIndex: number) => {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(line.slice(lastIndex, index));
    const token = match[0];
    let color: string | undefined;
    if (token.startsWith('//') || token.startsWith('#')) color = 'var(--chakra-colors-green-400)';
    else if (`"'\``.includes(token[0])) color = 'var(--chakra-colors-orange-300)';
    else if (/^\d/.test(token)) color = 'var(--chakra-colors-purple-300)';
    else if (KEYWORDS.has(token.toLocaleLowerCase())) color = 'var(--chakra-colors-blue-300)';
    nodes.push(
      color ? (
        <span key={`${lineIndex}-${index}`} style={{ color }}>
          {token}
        </span>
      ) : (
        token
      ),
    );
    lastIndex = index + token.length;
  }
  if (lastIndex < line.length) nodes.push(line.slice(lastIndex));
  return nodes;
};

const SftpEditorModal: React.FC<SftpEditorModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  filePath,
  fileName,
}) => {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const highlightRef = useRef<HTMLPreElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const language =
    LANGUAGE_BY_EXTENSION[fileName.split('.').pop()?.toLocaleLowerCase() ?? ''] ?? 'Plain Text';
  const isDirty = content !== savedContent;
  const highlightedContent = useMemo(
    () =>
      content.split('\n').map((line, index) => (
        <React.Fragment key={index}>
          {highlightLine(line, index)}
          {index < content.split('\n').length - 1 ? '\n' : null}
        </React.Fragment>
      )),
    [content],
  );

  useEffect(() => {
    if (isOpen && sessionId && filePath) {
      loadContent();
    } else {
      setContent('');
      setSavedContent('');
      setError(null);
    }
  }, [isOpen, sessionId, filePath]);

  const loadContent = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await invoke<string>('sftp_read_file_content', {
        sessionId,
        remotePath: filePath,
      });
      setContent(data);
      setSavedContent(data);
    } catch (err) {
      console.error('Failed to read file', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await invoke('sftp_write_file_content', {
        sessionId,
        remotePath: filePath,
        content,
      });
      setSavedContent(content);
    } catch (err) {
      console.error('Failed to write file', err);
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const updateCursor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const beforeCursor = editor.value.slice(0, editor.selectionStart);
    const lines = beforeCursor.split('\n');
    setCursor({ line: lines.length, column: lines[lines.length - 1].length + 1 });
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
      event.preventDefault();
      if (!isSaving && !isLoading && !error) handleSave();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const editor = event.currentTarget;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const updated = `${content.slice(0, start)}  ${content.slice(end)}`;
      setContent(updated);
      requestAnimationFrame(() => {
        editor.selectionStart = editor.selectionEnd = start + 2;
        updateCursor();
      });
    }
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="xl"
      placement="center"
    >
      <DialogContent
        bg="bg.panel"
        borderColor="border.subtle"
        maxW="80vw"
        h="80vh"
        display="flex"
        flexDirection="column"
      >
        <DialogHeader>
          <DialogTitle color="fg.default" fontSize="14px">
            Edit File: {fileName}
            {isDirty ? ' •' : ''}
          </DialogTitle>
        </DialogHeader>

        <DialogBody flex={1} display="flex" flexDirection="column" p={4} overflow="hidden">
          {isLoading ? (
            <Box display="flex" alignItems="center" justifyContent="center" flex={1}>
              <Spinner size="md" color="#38bdf8" />
            </Box>
          ) : error ? (
            <Box p={4} color="red.400" bg="red.subtle" borderRadius="md">
              <Text fontSize="12px">Error: {error}</Text>
            </Box>
          ) : (
            <Box
              flex={1}
              position="relative"
              overflow="hidden"
              bg="bg.muted"
              border="1px solid"
              borderColor="border.subtle"
              borderRadius="md"
              _focusWithin={{ borderColor: 'blue.fg' }}
            >
              <Box
                as="pre"
                ref={highlightRef}
                aria-hidden="true"
                position="absolute"
                inset={0}
                m={0}
                p={4}
                overflow="hidden"
                whiteSpace="pre"
                fontFamily='"Cascadia Code", Menlo, "Courier New", monospace'
                fontSize="13px"
                lineHeight="1.5"
                letterSpacing="normal"
                fontVariantLigatures="none"
                color="fg"
                pointerEvents="none"
              >
                {highlightedContent}
                {'\n'}
              </Box>
              <Textarea
                ref={editorRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  updateCursor();
                }}
                onSelect={updateCursor}
                onKeyDown={handleEditorKeyDown}
                onScroll={(event) => {
                  if (!highlightRef.current) return;
                  highlightRef.current.scrollTop = event.currentTarget.scrollTop;
                  highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
                }}
                flex={1}
                w="full"
                h="full"
                fontFamily='"Cascadia Code", Menlo, "Courier New", monospace'
                fontSize="13px"
                lineHeight="1.5"
                letterSpacing="normal"
                fontVariantLigatures="none"
                p={4}
                bg="transparent"
                color="transparent"
                caretColor="fg"
                border="none"
                borderRadius={0}
                resize="none"
                wrap="off"
                spellCheck={false}
                _focus={{ outline: 'none' }}
                css={{
                  '&::-webkit-scrollbar': { width: '8px', height: '8px' },
                  '&::-webkit-scrollbar-track': { background: 'transparent' },
                  '&::-webkit-scrollbar-thumb': {
                    background: 'var(--chakra-colors-border-subtle)',
                    borderRadius: '4px',
                  },
                }}
              />
            </Box>
          )}
        </DialogBody>

        <DialogFooter>
          <HStack gap={3} w="full">
            <Badge variant="subtle" colorPalette="blue">
              {language}
            </Badge>
            <Text fontSize="11px" color="fg.muted">
              Ln {cursor.line}, Col {cursor.column}
            </Text>
            <Text fontSize="11px" color={isDirty ? 'orange.fg' : 'fg.muted'}>
              {isDirty ? 'Modified' : 'Saved'}
            </Text>
            <Box flex={1} />
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isLoading || isSaving}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              size="sm"
              onClick={handleSave}
              loading={isSaving}
              disabled={isLoading || !!error || !isDirty}
            >
              Save
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default SftpEditorModal;
