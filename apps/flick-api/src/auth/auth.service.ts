import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new BadRequestException('อีเมลนี้ถูกใช้งานแล้ว (Email already in use)');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 12);

    const user = await this.usersService.create({
      email: registerDto.email,
      displayName: registerDto.displayName,
      phone: registerDto.phone,
      passwordHash: hashedPassword,
    });

    const payload = { sub: user.id, email: user.email };
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('อีเมลหรือรหัสผ่านไม่ถูกต้อง (Invalid credentials)');
    }

    const payload = { sub: user.id, email: user.email };
    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
