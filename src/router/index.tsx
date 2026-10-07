import { Navigate, createBrowserRouter } from 'react-router-dom';
import App from '../App';
import { DesignView } from '../views/DesignView';
import { NestingView } from '../views/NestingView';
import { ExportView } from '../views/ExportView';
import { CollabView } from '../views/CollabView';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/design" replace /> },
      { path: 'design', element: <DesignView /> },
      { path: 'nesting', element: <NestingView /> },
      { path: 'collab', element: <CollabView /> },
      { path: 'export', element: <ExportView /> },
      { path: '*', element: <Navigate to="/design" replace /> },
    ],
  },
]);

