//! 视频流协议调试模块
//! 支持 RTSP/RTMP/HTTP-FLV/HLS/WebRTC/GB28181/SRT

pub mod ffmpeg_manager;
pub mod gb28181;
pub mod hls;
pub mod http_flv;
pub mod media_gateway;
pub mod onvif;
pub mod player;
pub mod rtmp;
pub mod rtsp;
pub mod srt;
pub mod state;
pub mod webrtc;

pub use state::VideoStreamState;
