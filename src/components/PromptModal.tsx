import React, { useState, useEffect, useRef } from 'react';
import { Stack, Input, Button, HStack, Text } from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from './ui/dialog';

interface PromptField {
  key: string;
  label: string;
  placeholder?: string;
}

interface PromptModalProps {
  isOpen: boolean;
  title: string;
  fields: PromptField[];
  onConfirm: (values: Record<string, string>) => void;
  onClose: () => void;
}

/**
 * A native-looking prompt modal that replaces `window.prompt`.
 * Supports one or more labelled text fields and calls `onConfirm` with their values.
 */
const PromptModal: React.FC<PromptModalProps> = ({ isOpen, title, fields, onConfirm, onClose }) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      const empty: Record<string, string> = {};
      fields.forEach((f) => (empty[f.key] = ''));
      setValues(empty);
      // Auto-focus the first input after the dialog animates in
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [isOpen, fields]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allFilled = fields.every((f) => values[f.key]?.trim());
    if (!allFilled) return;
    onConfirm(values);
    onClose();
  };

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={(e) => !e.open && onClose()}
      size="sm"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <form id="prompt-form" onSubmit={handleSubmit}>
            <Stack gap={3}>
              {fields.map((field, i) => (
                <Stack key={field.key} gap={1}>
                  <Text fontSize="12px" fontWeight="500" color="fg.muted">
                    {field.label}
                  </Text>
                  <Input
                    ref={i === 0 ? firstInputRef : undefined}
                    size="sm"
                    value={values[field.key] ?? ''}
                    placeholder={field.placeholder ?? field.label}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </Stack>
              ))}
            </Stack>
          </form>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" colorPalette="blue" type="submit" form="prompt-form">
              OK
            </Button>
          </HStack>
        </DialogFooter>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  );
};

export default PromptModal;
