import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { THESIS_MAX_LENGTH } from '@kamby/domain';

export class SetThesisDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(THESIS_MAX_LENGTH)
  text!: string;
}
