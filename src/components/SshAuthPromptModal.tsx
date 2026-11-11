import React, { useEffect, useRef, useState } from 'react';
import { Button, HStack, Input, Stack, Text } from '@chakra-ui/react';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { useTranslation } from '../store/useLocaleStore';
import type { SshAuthPromptEvent } from '../types/ssh';

interface SshAuthPromptModalProps {
  prompt: SshAuthPromptEvent | null;
  onSubmit: (responses: string[]) => void;
  onCancel: () => void;
}

const SshAuthPromptModal: React.FC<SshAuthPromptModalProps> = ({ prompt, onSubmit, onCancel }) => {
  const { t } = useTranslation();
  const [values, setValues] = useState<string[]>(() => prompt?.prompts.map(() => '') ?? []);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const [prevPrompt, setPrevPrompt] = useState(prompt);
  if (prevPrompt !== prompt) {
    setPrevPrompt(prompt);
    setValues(prompt?.prompts.map(() => '') ?? []);
  }

  useEffect(() => {
    if (!prompt) return;
    const timer = window.setTimeout(() => firstInputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [prompt]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!prompt) return;
    onSubmit(values);
  };

  const title = prompt?.name?.trim() || t('auth.title');

  return (
    <DialogRoot
      open={prompt !== null}
      onOpenChange={(event) => !event.open && onCancel()}
      size="sm"
      placement="center"
    >
      <DialogContent bg="bg.panel" borderColor="border.subtle">
        <DialogHeader>
          <DialogTitle color="fg.default">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody pb={2}>
          <form id="auth-prompt-form" onSubmit={submit}>
            <Stack gap={3}>
              {prompt?.instructions && (
                <Text fontSize="12px" color="fg.muted" whiteSpace="pre-wrap">
                  {prompt.instructions}
                </Text>
              )}
              {prompt?.prompts.map((field, index) => (
                <Stack key={`${field.prompt}-${index}`} gap={1}>
                  <Text fontSize="12px" fontWeight="500" color="fg.muted">
                    {field.prompt}
                  </Text>
                  <Input
                    ref={index === 0 ? firstInputRef : undefined}
                    type={field.echo ? 'text' : 'password'}
                    aria-label={field.prompt}
                    size="sm"
                    value={values[index] ?? ''}
                    onChange={(event) =>
                      setValues((previous) =>
                        previous.map((value, valueIndex) =>
                          valueIndex === index ? event.target.value : value,
                        ),
                      )
                    }
                  />
                </Stack>
              ))}
            </Stack>
          </form>
        </DialogBody>
        <DialogFooter>
          <HStack gap={2}>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" colorPalette="blue" type="submit" form="auth-prompt-form">
              {t('auth.submit')}
            </Button>
          </HStack>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
};

export default SshAuthPromptModal;
