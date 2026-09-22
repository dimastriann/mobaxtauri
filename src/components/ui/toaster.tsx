import { createToaster, Toaster as ChakraToaster, Portal, Toast } from '@chakra-ui/react';

export const toaster = createToaster({
  placement: 'bottom-end',
  pauseOnPageIdle: true,
  max: 3,
});

export const Toaster = () => {
  return (
    <Portal>
      <ChakraToaster toaster={toaster}>
        {(toast) => (
          <Toast.Root key={toast.id}>
            <Toast.Title>{toast.title}</Toast.Title>
            {toast.description && <Toast.Description>{toast.description}</Toast.Description>}
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
};
