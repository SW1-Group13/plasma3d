import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from '@/app/AppRouter';
import { Toaster } from '@/shared/ui/toast';
import { PwaUpdatePrompt } from '@/app/PwaUpdatePrompt';

export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
      <Toaster />
      <PwaUpdatePrompt />
    </BrowserRouter>
  );
}
