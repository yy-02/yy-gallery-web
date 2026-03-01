import { Response, AnimalPhoto } from "../models/gallery.ts";
import {
  Image,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody, Spacer, Card, CardFooter, Button, Chip
} from "@heroui/react";
import { IoCalendarOutline, IoLocationOutline } from "react-icons/io5";
import moment from "moment";
import useMediaQuery from "../hooks/useMediaQuery.tsx";
import DialogMap from "./dialog_map.tsx";
import { MdOutlineOpenInNew } from "react-icons/md";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

export interface AnimalModalProps {
  photo: AnimalPhoto
  isOpen: boolean,
  onOpenChange: (isOpen: boolean, path?: string) => void;
}

export default function AnimalModal(props: AnimalModalProps) {
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const { t, i18n } = useTranslation()
  const [photo, setPhoto] = useState(props.photo)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (props.isOpen) {
      setLoading(true)
      setTimeout(() => {
        api.get<Response<AnimalPhoto>>(`/animals/photo?id=${props.photo.id}`).then(res => {
          setPhoto(res.data.payload)
          setLoading(false)
        })
      }, 100)
    }
  }, [props.isOpen, props.photo.id])

  const isPortrait = photo.thumb_file.width <= photo.thumb_file.height;
  const animalName = i18n.language === 'zh-CN' ? photo.animal.name_zh : photo.animal.name_en

  const locationInfo = useMemo(() => {
    if (!photo.metadata.city) return null;
    return <div className='flex gap-1'>
      <div className="font-bold">{photo.metadata.city?.prefecture.name}</div>
      <div className="font-bold">{photo.metadata.city?.name}</div>
    </div>
  }, [photo.metadata.city])

  const modal = useMemo(() => {
    return <ModalContent className='overflow-hidden'>
      {() => (
        (!isDesktop) || (!isPortrait) ?
          <>
            <ModalHeader className="p-0 flex flex-col gap-1">
              <Card
                isFooterBlurred
                radius="lg"
                className="border-none items-center"
              >
                <Image
                  isBlurred
                  draggable={false}
                  classNames={{
                    img: 'pointer-events-none',
                    blurredImg: 'pointer-events-none'
                  }}
                  className="object-contain"
                  src={photo.medium_file?.url}
                  width={photo.medium_file?.width}
                  height={photo.medium_file?.height}
                  style={{ maxHeight: isDesktop ? 'calc(100dvh - 20rem)' : 'calc(100dvh - 18rem)', height: 'auto' }}
                />
                <CardFooter
                  className="justify-between before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 shadow-small right-1 z-10 w-auto font-normal">
                  <div className='text-tiny md:text-small text-white/80'>{animalName}</div>
                </CardFooter>
              </Card>
            </ModalHeader>
            <ModalBody className="p-4">
              <div className='flex flex-wrap items-center gap-1 justify-between'>
                {
                  photo.metadata.city ?
                    <div className='flex items-center text-default-500 gap-1'>
                      <IoLocationOutline className='shrink-0' size={20}/>
                      <div className='flex flex-wrap gap-x-3'>
                        {locationInfo}
                        {photo.metadata.place && (
                          <div className='flex items-center'>
                            <div>{photo.metadata.place.name}</div>
                          </div>
                        )}
                      </div>
                    </div>
                    :
                    <div />
                }

                <div className='flex items-center gap-4'>
                  <div className='flex items-center text-small text-default-500 gap-1.5'>
                    <IoCalendarOutline size={18}/>
                    <div>
                      {moment(photo.metadata.datetime).format('YYYY/MM/DD')}
                    </div>
                  </div>
                </div>
              </div>

              <div className='gap-4 grid grid-cols-1 md:grid-cols-2'>
                <div className='py-2 flex flex-col gap-2'>
                  <div className='flex space-x-2 text-default-500'>
                    <Chip variant="flat">
                      {t(`animal.category.${photo.animal.category}`)}
                    </Chip>
                  </div>
                  {photo.animal.scientific_name && (
                    <div className='text-small text-default-400 italic'>
                      {photo.animal.scientific_name}
                    </div>
                  )}
                </div>

                {photo.metadata.location && (
                  <Card className='overflow-hidden min-h-[109px]' isFooterBlurred>
                    <DialogMap coordinate={photo.metadata.location}/>
                    <CardFooter
                      className="justify-between before:bg-white/10 border-white/20 border-1 overflow-hidden p-0 absolute before:rounded-xl rounded-large bottom-1 shadow-small right-1 z-10 w-auto font-normal">
                      <Button
                        className="text-tiny text-white bg-black/20"
                        variant="flat"
                        color="default"
                        radius="lg"
                        size="sm"
                        isIconOnly
                        onPress={() => {
                          window.open(`https://maps.google.com/?q=${photo.metadata.location!.latitude},${photo.metadata.location!.longitude}`)
                        }}
                      >
                        <MdOutlineOpenInNew size={16}/>
                      </Button>
                    </CardFooter>
                  </Card>
                )}
              </div>
            </ModalBody>
          </>
          :
          <>
            <ModalHeader className="p-0 flex flex-col gap-1"/>
            <ModalBody className="p-0 overflow-hidden">
              <div className='flex overflow-hidden'>
                <div className='w-[54%]'>
                  <Card
                    isFooterBlurred
                    radius="lg"
                    className="border-none h-full"
                  >
                    <Image
                      isBlurred
                      classNames={{
                        wrapper: 'h-full',
                        zoomedWrapper: 'h-full',
                        blurredImg: 'h-full pointer-events-none',
                        img: 'pointer-events-none',
                      }}
                      className="object-contain h-full"
                      src={photo.medium_file?.url}
                      width={photo.medium_file?.width}
                      height={photo.medium_file?.height}
                      style={{ height: 'auto', maxHeight: '100%' }}
                    />
                    <CardFooter
                      className="justify-between before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 shadow-small right-1 z-10 w-auto font-normal">
                      <div className='text-tiny md:text-small text-white/80'>{animalName}</div>
                    </CardFooter>
                  </Card>
                </div>

                <div className='w-[46%] p-6 flex flex-col gap-1 justify-end'>
                  {
                    photo.metadata.city ?
                      <div className='flex items-center text-default-500 gap-1'>
                        <IoLocationOutline size={20}/>
                        <div className='flex flex-wrap gap-x-3'>
                          {locationInfo}
                          {photo.metadata.place && (
                            <div className='flex items-center'>
                              <div>{photo.metadata.place.name}</div>
                            </div>
                          )}
                        </div>
                      </div>
                      :
                      null
                  }

                  <div className='flex items-center gap-4'>
                    <div className='flex items-center text-default-500 gap-1 text-small'>
                      <IoCalendarOutline size={20}/>
                      {moment(photo.metadata.datetime).format('YYYY/MM/DD')}
                    </div>
                  </div>

                  <div className='py-2 flex flex-col gap-2'>
                    <div className='flex space-x-2 text-default-500'>
                      <Chip variant="flat">
                        {t(`animal.category.${photo.animal.category}`)}
                      </Chip>
                    </div>
                    {photo.animal.scientific_name && (
                      <div className='text-small text-default-400 italic'>
                        {photo.animal.scientific_name}
                      </div>
                    )}
                  </div>

                  <Spacer y={4}/>

                  {photo.metadata.location && (
                    <div className='gap-4 grid grid-cols-1'>
                      <Card className='overflow-hidden min-h-[256px]' isFooterBlurred>
                        <DialogMap coordinate={photo.metadata.location}/>
                        <CardFooter
                          className="justify-between before:bg-white/10 border-white/20 border-1 overflow-hidden p-0 absolute before:rounded-xl rounded-large bottom-1 shadow-small right-1 z-10 w-auto font-normal">
                          <Button
                            className="text-tiny text-white bg-black/20"
                            variant="flat"
                            color="default"
                            radius="lg"
                            size="sm"
                            isIconOnly
                            onPress={() => {
                              window.open(`https://maps.google.com/?q=${photo.metadata.location!.latitude},${photo.metadata.location!.longitude}`)
                            }}
                          >
                            <MdOutlineOpenInNew size={16}/>
                          </Button>
                        </CardFooter>
                      </Card>
                    </div>
                  )}
                </div>
              </div>
            </ModalBody>
          </>
      )}
    </ModalContent>
  }, [locationInfo, isDesktop, isPortrait, loading, photo, animalName, t])

  return <Modal
    isOpen={props.isOpen}
    onOpenChange={props.onOpenChange}
    backdrop='blur'
    size='4xl'
    scrollBehavior='inside'
    classNames={{
      closeButton: 'z-20'
    }}
  >
    {modal}
  </Modal>;
}
