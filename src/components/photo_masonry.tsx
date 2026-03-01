import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Photo, Response } from "../models/gallery.ts";
import { api } from "../lib/api";
import { Card, Image, CardFooter, CardBody, useDisclosure } from "@heroui/react";
import useMediaQuery from "../hooks/useMediaQuery.tsx";
import PhotoModal from "../components/photo_modal.tsx";
import { useWindowSize } from "@react-hook/window-size";
import {
  useContainerPosition,
  useInfiniteLoader,
  useMasonry,
  usePositioner,
  useScroller
} from "masonic";
import { useNavigate } from "react-router-dom";

const PAGE_SIZE = 20;

export default function PhotoMasonry(props: { prefectureId?: string, cityId?: string }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [hasMore, setHasMore] = useState(true)
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const loadingRef = useRef(false);
  const currentPageRef = useRef(1);
  const loadedIdsRef = useRef<Set<number>>(new Set());

  const containerRef = useRef(null);
  const [windowWidth, height] = useWindowSize();
  const { offset, width } = useContainerPosition(containerRef, [
    windowWidth,
    height
  ]);
  const positioner = usePositioner({
    width,
    columnGutter: 8,
    columnCount: isDesktop ? 3 : 2,
  });
  const { scrollTop, isScrolling } = useScroller(offset);
  const query = useMemo(() => ({
    prefecture_id: props.prefectureId && props.prefectureId !== '0' ? props.prefectureId : undefined,
    city_id: props.cityId && props.cityId !== '0' ? props.cityId : undefined,
  }), [props.cityId, props.prefectureId])

  useEffect(() => {
    currentPageRef.current = 1;
    loadedIdsRef.current = new Set();
    setHasMore(true);
    
    api.get<Response<Photo[]>>('/photos/all', {
      params: {
        ...query,
        page: 1,
        limit: PAGE_SIZE
      }
    }).then(res => {
      const newPhotos = res.data.payload;
      newPhotos.forEach(p => loadedIdsRef.current.add(p.id));
      setPhotos(newPhotos);
      setHasMore(newPhotos.length >= PAGE_SIZE);
    })
  }, [query])

  const maybeLoadMore = useInfiniteLoader(
    useCallback(() => {
      if (loadingRef.current || !hasMore) {
        return;
      }
      
      loadingRef.current = true;
      const nextPage = currentPageRef.current + 1;

      api.get<Response<Photo[]>>('/photos/all', {
        params: {
          ...query,
          page: nextPage,
          limit: PAGE_SIZE,
        }
      }).then((res) => {
        const newPhotos = res.data.payload.filter(p => !loadedIdsRef.current.has(p.id));
        
        if (newPhotos.length > 0) {
          newPhotos.forEach(p => loadedIdsRef.current.add(p.id));
          setPhotos((current) => [...current, ...newPhotos]);
          currentPageRef.current = nextPage;
        }
        
        setHasMore(res.data.payload.length >= PAGE_SIZE);
      }).finally(() => {
        loadingRef.current = false;
      });
    }, [query, hasMore]),
    {
      isItemLoaded: (index, items) => !!items[index],
      minimumBatchSize: PAGE_SIZE,
      threshold: 3,
    }
  );

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

const MasonryCard = ({ data }: { data: Photo }) => {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const navigate = useNavigate()

  const openPhotoModel = useMemo(() => () => {
    history.pushState({}, '', `/photo/${data.id}`)
    onOpen();
  }, [onOpen, data.id])

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
    {
      data.metadata.city ?
        <CardFooter className="text-small justify-between flex-wrap">
          <b>
            {`${data.metadata.city.prefecture.name} ${data.metadata.city.name}`}
          </b>
          <p className="text-default-500">
            {`${data.metadata.city.prefecture.country.name}`}
          </p>
        </CardFooter>
        :
        null
    }

    <PhotoModal photo={data} isOpen={isOpen} onOpenChange={(isOpen, path) => {
      if (!isOpen && path) {
        navigate(path)
      } else if (!isOpen) {
        history.back()
      }
      onOpenChange()
    }}/>
  </Card>
};
