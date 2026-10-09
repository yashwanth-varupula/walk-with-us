import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';

export default function MainLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      {/*
        The skip link in Header targets this id. It is also given tabIndex={-1}
        so it can receive focus programmatically, which is what actually moves
        the screen reader cursor past the navigation.
      */}
      <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
