import sonyAlpha from '../assets/logos/Sony_Alpha_logo.svg';
import lumix from '../assets/logos/Lumix_logo.svg';
import lumixDark from '../assets/logos/Lumix_logo_dark.svg';
import nikonLogoTm from '../assets/logos/Nikon-logo-tm.svg';
import nikonZ5Black from '../assets/logos/z-5-black.svg';
import nikonZ5White from '../assets/logos/z-5-white.svg';
import nikonZ8Black from '../assets/logos/z-8-black.svg';
import nikonZ8White from '../assets/logos/z-8-white.svg';
import canonLogo from '../assets/logos/Canon-logo.svg';
import { Camera } from "../models/gallery.ts";
import useDarkMode from "use-dark-mode";
import { Tooltip } from "@heroui/react";
import { JSX } from "react";

const nikonModels: { [k: string]: { light: string, dark: string } } = {
  'Z 5': { light: nikonZ5Black, dark: nikonZ5White },
  'Z 8': { light: nikonZ8Black, dark: nikonZ8White },
}

export interface CameraNameProps {
  camera?: Camera
}

export default function CameraName(props: CameraNameProps) {
  const darkmode = useDarkMode()

  if (!props.camera) return;
  if (!props.camera?.general_name) return props.camera?.model

  let cameraName: JSX.Element

  if (props.camera.manufacture.name === 'SONY' && props.camera.general_name.startsWith('α')) {
    cameraName = <Tooltip content={props.camera.model} showArrow placement='right'>
      <div className='flex items-center'>
        <img alt='α' src={sonyAlpha} className='h-[0.7rem] mr-1 inline'/>
        {props.camera.general_name.replace('α', '')}
      </div>
    </Tooltip>
  } else if (props.camera.manufacture.name === 'Panasonic' && props.camera.general_name.startsWith('Lumix')) {
    cameraName = <Tooltip content={props.camera.model} showArrow placement='right'>
      <div className='flex items-center'>
        <img alt='Lumix' src={darkmode.value ? lumixDark : lumix} className='h-[0.8rem] mr-1 inline'/>
        {props.camera.general_name.replace('Lumix', '')}
      </div>
    </Tooltip>
  } else if (props.camera.manufacture.name === 'NIKON CORPORATION' && nikonModels[props.camera.general_name]) {
    const modelLogo = nikonModels[props.camera.general_name]
    cameraName = <Tooltip content={props.camera.model} showArrow placement='right'>
      <div className='flex items-center gap-1'>
        <img alt='Nikon' src={nikonLogoTm} className='h-[1.1rem] inline'/>
        <span className='text-[0.75rem] font-semibold'>NIKON</span>
        <img alt={props.camera.general_name} src={darkmode.value ? modelLogo.dark : modelLogo.light} className='h-[1.1rem] inline'/>
      </div>
    </Tooltip>
  } else if (props.camera.manufacture.name === 'Canon') {
    const modelName = props.camera.general_name.replace(/^Canon\s*/i, '')
    cameraName = <Tooltip content={props.camera.model} showArrow placement='right'>
      <div className='flex items-center gap-1'>
        <img alt='Canon' src={canonLogo} className='h-[0.85rem] inline'/>
        <span className='text-[0.75rem]'>{modelName}</span>
      </div>
    </Tooltip>
  } else {
    cameraName = <span>{props.camera.general_name}</span>
  }

  return cameraName;
}
