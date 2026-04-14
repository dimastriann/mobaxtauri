import { createSystem, defineConfig, defaultConfig } from "@chakra-ui/react"

const config = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        bg: {
          panel: {
            value: { _light: "{colors.white}", _dark: "#12121e" },
          },
          muted: {
            value: { _light: "{colors.gray.50}", _dark: "#1a1a2e" },
          },
        },
        border: {
          subtle: {
             value: { _light: "{colors.gray.200}", _dark: "rgba(255,255,255,0.06)" }
          }
        },
        blue: {
          fg: {
            value: { _light: "{colors.blue.600}", _dark: "#38bdf8" }
          }
        },
        orange: {
          fg: {
            value: { _light: "{colors.orange.600}", _dark: "#f59e0b" }
          }
        },
        red: {
          fg: {
            value: { _light: "{colors.red.600}", _dark: "#f87171" }
          }
        }
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
