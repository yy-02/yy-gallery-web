import { useEffect, useMemo, useRef, useState } from "react";
import { Response, AnimalPhoto } from "../models/gallery.ts";
import { api } from "../lib/api";
import { Card, Image, CardFooter, CardBody, useDisclosure } from "@heroui/react";
import useMediaQuery from "../hooks/useMediaQuery.tsx";
import { useWindowSize } from "@react-hook/window-size";
import {
  useContainerPosition,
  useInfiniteLoader,
  useMasonry,
  usePositioner,
  useScroller
} from "masonic";
import { useNavigate } from "react-router-dom";
import AnimalModal from "./animal_modal.tsx";
import { useTranslation } from "react-i18next";


export default function AnimalMasonry() {
  const [photos, setPhotos] = useState<AnimalPhoto[]>([])
  const isDesktop = useMediaQuery('(min-width: 720px)');
  const loadedIndex = useRef<{ startIndex: number, stopIndex: number }[]>([]);

  const containerRef = useRef(null);
  const [windowWidth, height] = useWindowSize();
  const { offset, width } = useContainerPosition(containerRef, [
    windowWidth,
    height
  ]);
  const positioner = usePositioner({
    width,
    columnGutter: 8,
    columnCount: isDesktop ? 4 : 2,
  });
  const { scrollTop, isScrolling } = useScroller(offset);

  useEffect(() => {
    api.get<Response<AnimalPhoto[]>>('/animals/photos', {
      params: {
        page_size: 20
      }
    }).then(res => {
      setPhotos(res.data.payload)
    })
  }, [])

  const maybeLoadMore = useInfiniteLoader((startIndex, stopIndex, items) => {
    if (loadedIndex.current.find((e) => e.startIndex === startIndex && e.stopIndex === stopIndex)) {
      return;
    }
    loadedIndex.current.push({ startIndex, stopIndex })

    const lastDatetime = (items[items.length - 1] as AnimalPhoto).metadata.datetime
    api.get<Response<AnimalPhoto[]>>('/animals/photos', {
      params: {
        page_size: stopIndex - startIndex,
        last_datetime: lastDatetime,
      }
    }).then((res) => {
      const newItems = res.data.payload.filter((item) => !photos.find(p => p.id === item.id));
      if (newItems.length > 0) {
        setPhotos((current) => [...current, ...newItems]);
      }
    })
  }, {
    isItemLoaded: (index, items) => !!items[index],
  });

  return useMasonry({
    positioner,
    scrollTop,
    isScrolling,
    height,
    containerRef,
    items: photos,
    overscanBy: 3,
    itemHeightEstimate: 0,
    onRender: maybeLoadMore,
    render: MasonryCard,
    itemKey: (item) => item.id,
  })
}

const MasonryCard = ({ data }: { data: AnimalPhoto }) => {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const navigate = useNavigate()
  const { i18n } = useTranslation()

  const openPhotoModel = useMemo(() => () => {
    history.pushState({}, '', `/animal/${data.id}`)
    onOpen();
  }, [onOpen, data.id])

  const animalName = i18n.language === 'zh-CN' ? data.animal.name_zh : data.animal.name_en

  return <Card
    radius="lg"
    className="border-none"
    isPressable={isDesktop}
    onPress={isDesktop ? openPhotoModel : undefined}
  >
    <CardBody className="overflow-visible p-0" onClick={isDesktop ? undefined : openPhotoModel}>
      <Image
        className="object-cover"
        draggable={false}
        classNames={{
          img: 'pointer-events-none',
          blurredImg: 'pointer-events-none'
        }}
        src={data.thumb_file.url}
        width={data.thumb_file.width}
        height={data.thumb_file.height}
        style={{ height: 'auto' }}
      />
    </CardBody>
    <CardFooter className="text-small justify-between flex-wrap">
      <b>
        {animalName}
      </b>
      {data.animal.scientific_name && (
        <p className="text-default-400 text-xs italic truncate">
          {data.animal.scientific_name}
        </p>
      )}
    </CardFooter>

    <AnimalModal photo={data} isOpen={isOpen} onOpenChange={(isOpen, path) => {
      if (!isOpen && path) {
        navigate(path)
      } else if (!isOpen) {
        history.back()
      }
      onOpenChange()
    }}/>
  </Card>
};
