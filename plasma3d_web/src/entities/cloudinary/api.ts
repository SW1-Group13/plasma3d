import axios from 'axios';
import { env } from '@/shared/config/env';
import type { CloudinaryResponse } from '@/entities/cloudinary/types';

export const cloudinaryApi = {
  async uploadImage(file: File): Promise<CloudinaryResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', env.cloudinaryUploadPreset);
    const { data } = await axios.post<CloudinaryResponse>(
      `${env.cloudinary}/${env.cloudinaryCloudName}/image/upload`,
      formData,
    );
    return data;
  },
};
