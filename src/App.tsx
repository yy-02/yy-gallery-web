import { HeroUIProvider } from "@heroui/react";
import { Route, Routes, useNavigate } from "react-router-dom";
import Root from "./routes/root.tsx";
import Index from "./routes";
import Map from "./routes/map_openlayers.tsx";
import Photo from "./routes/photo.tsx";
import Prefecture from "./routes/prefecture.tsx";
import "./App.css"
import Mapkit from "./routes/cluster.tsx";
import AnimalsPage from "./routes/animals.tsx";
import AnimalPhotoPage from "./routes/animal.tsx";

function App() {
  const navigate = useNavigate();

  return (
    <HeroUIProvider navigate={navigate}>
      <Routes>
        <Route path="/" element={<Root/>}>
          <Route path="" element={<Index/>}/>
          <Route path="map" element={<Map/>}/>
          <Route path="animals" element={<AnimalsPage/>}/>
          <Route path="cluster" element={<Mapkit/>}/>
          <Route path="photo/:id" element={<Photo/>}/>
          <Route path="animal/:id" element={<AnimalPhotoPage/>}/>
          <Route path="prefecture/:prefectureId" element={<Prefecture/>}/>
          <Route path="prefecture/:prefectureId/city/:cityId" element={<Prefecture/>}/>
        </Route>
      </Routes>
    </HeroUIProvider>
  )
}

export default App
