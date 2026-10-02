import React, { useEffect, useRef, useState } from 'react';
import { Box, HStack, Text, Icon } from '@chakra-ui/react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose?: () => void;
  children: React.ReactNode;
}

// A fixed-position menu with no viewport awareness clips off the bottom
// or right edge when opened near a window border. Render at the requested
// anchor first, measure the actual size, then pull it inside the viewport.
export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, children }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const margin = 8;
    let { x: nextX, y: nextY } = { x: +x.toFixed(0), y: +y.toFixed(0) };
    if (nextX + rect.width > window.innerWidth - margin) {
      nextX = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (nextY + rect.height > window.innerHeight - margin) {
      nextY = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPosition({ x: nextX, y: nextY });
  }, [x, y]);

  return (
    <Box
      ref={menuRef}
      position="fixed"
      top={position.y}
      left={position.x}
      bg="bg.panel"
      border="1px solid"
      borderColor="border.subtle"
      borderRadius="8px"
      boxShadow="xl"
      zIndex={1000}
      py={1}
      minW="160px"
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

export const ContextMenuItem: React.FC<ContextMenuItemProps> = ({
  icon,
  label,
  onClick,
  color,
}) => {
  return (
    <HStack
      px={3}
      py={2}
      cursor="pointer"
      _hover={{ bg: 'bg.emphasized' }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      gap={3}
    >
      {icon && <Icon as={icon} boxSize="14px" color={color || 'fg.muted'} />}
      <Text fontSize="12px" color={color || 'fg'}>
        {label}
      </Text>
    </HStack>
  );
};

export const ContextMenuSeparator: React.FC = () => <Box h="1px" bg="border.subtle" my={1} />;
