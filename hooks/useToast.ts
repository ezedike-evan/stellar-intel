import { useToastContext, type ToastVariant } from '@/contexts/ToastContext';

export function useToast() {
  const { addToast } = useToastContext();
  return {
    toast: (message: string, variant?: ToastVariant) => addToast(message, variant),
  };
}
