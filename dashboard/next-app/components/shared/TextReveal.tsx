"use client";

import { motion } from "framer-motion";

interface TextRevealProps {
  text: string;
  className?: string;
  delay?: number;
  staggerDelay?: number;
}

export default function TextReveal({
  text,
  className = "",
  delay = 0,
  staggerDelay = 0.04,
}: TextRevealProps) {
  const words = text.split(" ");

  const containerVariants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: staggerDelay,
        delayChildren: delay,
      },
    },
  };

  const wordVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.4, ease: "easeOut" as const },
    },
  };

  return (
    <motion.span
      className={className}
      style={{ display: "inline-flex", flexWrap: "wrap", gap: "0.3em" }}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
    >
      {words.map((word, i) => (
        <motion.span key={`${word}-${i}`} variants={wordVariants}>
          {word}
        </motion.span>
      ))}
    </motion.span>
  );
}
