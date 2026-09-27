import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from '@/app/AppRouter';
import { Toaster } from '@/shared/ui/toast';

export function App() {
  return (
    <BrowserRouter>
      <AppRouter />
      <Toaster />
    </BrowserRouter>
  );
}
