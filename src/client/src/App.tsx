import { BrowserRouter, Routes, Route } from 'react-router-dom';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Routes>
          <Route path="/" element={<div>Project List (TODO)</div>} />
          <Route path="/projects/:id" element={<div>Project Detail (TODO)</div>} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
