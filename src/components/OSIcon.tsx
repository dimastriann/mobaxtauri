import { Icon } from '@chakra-ui/react';
import { IconType } from 'react-icons';
import { LuTerminal, LuMonitor } from 'react-icons/lu';
import {
  SiUbuntu,
  SiDebian,
  SiCentos,
  SiFedora,
  SiRedhat,
  SiArchlinux,
  SiAlpinelinux,
  SiRaspberrypi,
  SiApple,
  SiLinux,
} from 'react-icons/si';
import { FaWindows } from 'react-icons/fa';

interface OSIconProps {
  os?: string;
  boxSize?: number;
  color?: string;
}

export default function OSIcon({ os, boxSize = 5, color }: OSIconProps) {
  let SelectedIcon: IconType = LuTerminal;

  if (os) {
    const cleanOs = os.toLowerCase();
    if (cleanOs.includes('local')) {
      SelectedIcon = LuMonitor;
    } else if (cleanOs.includes('ubuntu')) {
      SelectedIcon = SiUbuntu;
    } else if (cleanOs.includes('debian')) {
      SelectedIcon = SiDebian;
    } else if (cleanOs.includes('centos')) {
      SelectedIcon = SiCentos;
    } else if (cleanOs.includes('fedora')) {
      SelectedIcon = SiFedora;
    } else if (cleanOs.includes('redhat') || cleanOs.includes('rhel')) {
      SelectedIcon = SiRedhat;
    } else if (cleanOs.includes('arch')) {
      SelectedIcon = SiArchlinux;
    } else if (cleanOs.includes('alpine')) {
      SelectedIcon = SiAlpinelinux;
    } else if (cleanOs.includes('raspbian') || cleanOs.includes('raspberry')) {
      SelectedIcon = SiRaspberrypi;
    } else if (cleanOs.includes('darwin') || cleanOs.includes('mac') || cleanOs.includes('apple')) {
      SelectedIcon = SiApple;
    } else if (cleanOs.includes('windows')) {
      SelectedIcon = FaWindows;
    } else if (cleanOs.includes('linux')) {
      SelectedIcon = SiLinux;
    }
  }

  return <Icon as={SelectedIcon} boxSize={boxSize} color={color} />;
}
