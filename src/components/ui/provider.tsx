import { ChakraProvider } from '@chakra-ui/react';
import { system } from '../../theme';
import { ColorModeProvider, type ColorModeProviderProps } from './color-mode';
import { Toaster } from './toaster';

export function Provider(props: ColorModeProviderProps) {
  return (
    <ChakraProvider value={system}>
      <ColorModeProvider {...props}>
        {props.children}
        <Toaster />
      </ColorModeProvider>
    </ChakraProvider>
  );
}
