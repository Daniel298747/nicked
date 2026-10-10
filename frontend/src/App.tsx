import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { DemoProvider } from './demo/store';
import { ScreenStateProvider } from './demo/ScreenStates';
import { AppShell, BareLayout, MarketingLayout, RequireAuth } from './components/layout/Layouts';
import { ButtonLink } from './components/ui/Button';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import { Login, Signup } from './pages/Auth';
import CheckoutSuccess from './pages/CheckoutSuccess';
import Dashboard from './pages/Dashboard';
import UploadPage from './pages/Upload';
import Processing from './pages/Processing';
import Queue from './pages/Queue';
import EventReview from './pages/EventReview';
import Report from './pages/Report';
import Billing from './pages/Billing';

function Root() {
  return (
    <DemoProvider>
      <ScreenStateProvider>
        <Outlet />
      </ScreenStateProvider>
    </DemoProvider>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <p className="font-mono text-caption text-ink-muted">404</p>
      <h1 className="mt-2 text-display">Nothing on this camera.</h1>
      <p className="mt-3 text-body-lg text-ink-muted">That page doesn't exist.</p>
      <ButtonLink to="/" className="mt-8">Go to the home page</ButtonLink>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        element: <MarketingLayout />,
        children: [
          { path: '/', element: <Landing /> },
          { path: '/pricing', element: <Pricing /> },
        ],
      },
      {
        element: <BareLayout />,
        children: [
          { path: '/signup', element: <Signup /> },
          { path: '/login', element: <Login /> },
          { path: '/billing/success', element: <CheckoutSuccess /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/app',
            element: <AppShell />,
            children: [
              { index: true, element: <Dashboard /> },
              { path: 'upload', element: <UploadPage /> },
              { path: 'clips/:id', element: <Processing /> },
              { path: 'queue', element: <Queue /> },
              { path: 'events/:id', element: <EventReview /> },
              { path: 'reports/:id', element: <Report /> },
              { path: 'settings/billing', element: <Billing /> },
            ],
          },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
