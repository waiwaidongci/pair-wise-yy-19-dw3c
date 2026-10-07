import { ChakraProvider, extendTheme } from '@chakra-ui/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './styles.css';

const theme = extendTheme({
  colors: {
    brand: {
      50: '#e8f5f3',
      500: '#0f766e',
      700: '#115e59',
      900: '#134e4a',
    },
  },
  fonts: {
    heading: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
    body: '"Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { baseStyle: { fontWeight: 700, textTransform: 'none' } },
    FormLabel: { baseStyle: { fontSize: '11px', fontWeight: 750, color: 'slate.600' } },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <RouterProvider router={router} />
    </ChakraProvider>
  </React.StrictMode>,
);

