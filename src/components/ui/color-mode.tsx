"use client"

import type { IconButtonProps } from "@chakra-ui/react"
import { ClientOnly, IconButton, Skeleton } from "@chakra-ui/react"
import * as React from "react"
import { LuMoon, LuSun } from "react-icons/lu"

export interface ColorModeProviderProps {
  children: React.ReactNode;
  defaultTheme?: string;
}

const ColorModeContext = React.createContext<{ theme: string; setTheme: (t: string) => void }>({ theme: 'dark', setTheme: () => {} });

export function ColorModeProvider({ children, defaultTheme = 'dark' }: ColorModeProviderProps) {
  const [theme, setThemeState] = React.useState(defaultTheme);

  React.useEffect(() => {
    const saved = localStorage.getItem('mobaxtauri-theme') || defaultTheme;
    setTheme(saved);
  }, []);

  const setTheme = (newTheme: string) => {
    setThemeState(newTheme);
    localStorage.setItem('mobaxtauri-theme', newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.style.colorScheme = 'light';
      document.documentElement.setAttribute('data-theme', 'light');
    }
  };

  return (
    <ColorModeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ColorModeContext.Provider>
  )
}

export function useColorMode() {
  const context = React.useContext(ColorModeContext);
  const toggleColorMode = () => {
    context.setTheme(context.theme === "light" ? "dark" : "light")
  }
  return {
    colorMode: context.theme,
    setColorMode: context.setTheme,
    toggleColorMode,
  }
}

export function useColorModeValue<T>(light: T, dark: T) {
  const { colorMode } = useColorMode()
  return colorMode === "light" ? light : dark
}

export function ColorModeIcon() {
  const { colorMode } = useColorMode()
  return colorMode === "light" ? <LuSun /> : <LuMoon />
}

interface ColorModeButtonProps extends Omit<IconButtonProps, "aria-label"> {}

export const ColorModeButton = React.forwardRef<
  HTMLButtonElement,
  ColorModeButtonProps
>(function ColorModeButton(props, ref) {
  const { toggleColorMode } = useColorMode()
  return (
    <ClientOnly fallback={<Skeleton boxSize="8" />}>
      <IconButton
        variant="ghost"
        aria-label="Toggle color mode"
        size="sm"
        ref={ref}
        {...props}
        onClick={(e) => {
          toggleColorMode();
          props.onClick?.(e);
        }}
      >
        <ColorModeIcon />
      </IconButton>
    </ClientOnly>
  )
})
