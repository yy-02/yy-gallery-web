import { useParams } from "react-router-dom";
import { useEffect, useState, cloneElement, MouseEvent } from "react";
import { AnimalPhoto, Response } from "../models/gallery.ts";
import { api } from "../lib/api";
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Chip,
  Divider,
  Image,
  Link,
} from "@heroui/react";
import moment from "moment/moment";
import useMediaQuery from "../hooks/useMediaQuery.tsx";
import ManufactureIcon from "../components/manufacture_icon.tsx";
import DialogMap from "../components/dialog_map.tsx";
import { MdOutlineOpenInNew } from "react-icons/md";
import { IoCalendarOutline, IoLocationOutline } from "react-icons/io5";
import { useTranslation } from "react-i18next";
import CameraName from "../components/camera_name.tsx";
import Zoom from 'react-medium-image-zoom'

export default function AnimalPhotoPage() {
  const { id } = useParams()
  const [photo, setPhoto] = useState<AnimalPhoto>()
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const { t, i18n } = useTranslation()

  useEffect(() => {
    api.get<Response<AnimalPhoto>>('/animals/photo', {
      params: { id }
    }).then((res) => {
      setPhoto(res.data.payload)
    })
  }, [id])

  if (!photo) return null;

  const animalName = i18n.language === 'zh-CN' ? photo.animal.name_zh : photo.animal.name_en
  const description = i18n.language === 'zh-CN' 
    ? (photo.description_zh || photo.description_en) 
    : (photo.description_en || photo.description_zh)

  return (
    <div className='scrollbar-hide px-[10px] md:px-[20px] box-content pt-4 pb-12'>
      <div className='text-5xl mb-8 md:mb-12 ml-2 pt-2'>
        #A{id}
      </div>

      <Card
        isFooterBlurred
        radius="lg"
        className="border-none"
      >
        <Zoom
          ZoomContent={({ buttonUnzoom, img, }) => <>
            {buttonUnzoom}
            {img ? cloneElement(img, {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              draggable: false,
              onContextMenu: (e: MouseEvent<HTMLImageElement>) => e.preventDefault()
            }) : null}
          </>}
        >
          <Image
            isBlurred
            className={`object-contain ${isDesktop ? 'max-h-128' : ''}`}
            draggable={false}
            onContextMenu={(e) => e.preventDefault()}
            src={photo.large_file!.url}
            width={photo.large_file!.width}
            height={photo.large_file!.height}
            style={{ height: 'auto' }}
          />
        </Zoom>
        <CardFooter
          className="justify-between before:bg-white/10 border-white/20 border-1 overflow-hidden py-1 absolute before:rounded-xl rounded-large bottom-1 shadow-small right-1 z-10 w-auto font-normal">
          <div className='text-tiny md:text-small text-white/80'>
            {animalName}
          </div>
        </CardFooter>
      </Card>

      {/* 照片说明 - 暂时隐藏 */}
      {/* {
        description &&
        <Card className='mt-4'>
          <CardBody>
            <p className='text-default-700 whitespace-pre-wrap'>
              {description}
            </p>
          </CardBody>
        </Card>
      } */}

      <div className='gap-4 grid grid-cols-1 md:grid-cols-2 mt-4 pb-4'>
        <div>
          <Card>
            <CardBody>
              <div className='flex flex-col gap-1'>
                {
                  photo.metadata.city ?
                    <div className='flex items-center text-default-500 gap-2'>
                      <IoLocationOutline className='shrink-0' size={20}/>
                      <div className='flex flex-wrap gap-x-3'>
                        <div className='flex gap-1'>
                          <div className="font-bold">{photo.metadata.city.prefecture.name}</div>
                          <div className="font-bold">{photo.metadata.city.name}</div>
                        </div>
                        {
                          photo.metadata.place ?
                            <div className='flex items-center'>
                              <Link color='foreground'>{photo.metadata.place.name}</Link>
                            </div>
                            :
                            null
                        }
                      </div>
                    </div>
                    :
                    null
                }

                <div className='flex items-center text-default-500 gap-2'>
                  <IoCalendarOutline size={20}/>
                  <div>
                    {moment(photo.metadata.datetime).format('YYYY/MM/DD')}
                  </div>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card className='overflow-visible mt-4'>
            <CardHeader className='text-small font-semibold bg-default-100 py-2'>
              <div>{t('animal.info')}</div>
            </CardHeader>
            <CardBody className='text-small py-2 overflow-y-visible'>
              <div className='flex flex-col gap-1'>
                <div className='font-bold text-lg'>{animalName}</div>
                {photo.animal.scientific_name && (
                  <div className='text-default-400 italic'>{photo.animal.scientific_name}</div>
                )}
                {photo.animal.description_zh && i18n.language === 'zh-CN' && (
                  <div className='text-default-500 mt-2'>{photo.animal.description_zh}</div>
                )}
                {photo.animal.description_en && i18n.language !== 'zh-CN' && (
                  <div className='text-default-500 mt-2'>{photo.animal.description_en}</div>
                )}
              </div>
            </CardBody>
            <Divider className='bg-default-100'/>
            <CardFooter className='py-2 flex space-x-2 text-default-500'>
              <Chip variant="flat">
                {t(`animal.category.${photo.animal.category}`)}
              </Chip>
            </CardFooter>
          </Card>

          {photo.metadata.camera && (
            <Card className='overflow-visible mt-4'>
              <CardHeader className='text-small font-semibold bg-default-100 py-2'>
                <ManufactureIcon name={photo.metadata.camera?.manufacture.name}/>
                <CameraName camera={photo.metadata.camera}/>
              </CardHeader>
              <CardBody className='text-small text-default-500 py-2 overflow-y-visible'>
                {photo.metadata.lens ?
                  `${photo.metadata.lens.manufacture.name} ${photo.metadata.lens.model}`
                  :
                  t('unknown_lens')
                }
              </CardBody>
              <Divider className='bg-default-100'/>
              <CardFooter className='py-2 flex justify-around text-default-500'>
                <code className='text-small'>ISO {photo.metadata.photographic_sensitivity}</code>
                <code className='text-small text-default-300 font-extralight'>|</code>
                <code className='text-small'>ƒ{photo.metadata.f_number}</code>
                <code className='text-small text-default-300 font-extralight'>|</code>
                <code className='text-small'>{photo.metadata.exposure_time_rat} s</code>
                <code className='text-small text-default-300 font-extralight'>|</code>
                <code className='text-small'>{photo.metadata.focal_length} mm</code>
              </CardFooter>
            </Card>
          )}
        </div>

        {
          photo.metadata.location &&
          <Card className='overflow-hidden min-h-[200px] md:min-h-0' isFooterBlurred>
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
        }
      </div>
    </div>
  );
}
