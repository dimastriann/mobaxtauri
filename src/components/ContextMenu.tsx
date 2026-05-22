import React from 'react';
import { Box, HStack, Text, Icon } from "@chakra-ui/react";

interface ContextMenuProps {
  x: number;
  y: number;
  onClose?: () => void;
  children: React.ReactNode;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, children }) => {
  return (
    <Box
      position="fixed" top={y} left={x}
      bg="bg.panel" border="1px solid" borderColor="border.subtle"
      borderRadius="8px" boxShadow="xl" zIndex={1000} py={1} minW="160px"
      onClick={() => onClose?.()}
    >
      {children}
    </Box>
  );
};

interface ContextMenuItemProps {
  icon?: any;
  label: string;
  onClick: () => void;
  color?: string;
}

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({ icon, label, onClick, color }) => {
  return (
    <HStack
      px={3} py={2} cursor="pointer" _hover={{ bg: 'whiteAlpha.50' }}
      onClick={(e) => { e.stopPropagation(); onClick(); }} gap={3}
    >
      {icon && <Icon as={icon} boxSize="14px" color={color || "fg.muted"} />}
      <Text fontSize="12px" color={color || "fg"}>{label}</Text>
    </HStack>
  );
};

export const ContextMenuSeparator: React.FC = () => (
  <Box h="1px" bg="border.subtle" my={1} />
);
